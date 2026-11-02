import { query, withTransaction } from '../db.js';

const LOTE = 5000;

// Guarda eventos normalizados (ver spotifyParser.js / lastfm.js) en una sola transacción:
//   1. crea la fila en importaciones
//   2. da de alta artistas, álbumes y canciones que no existan (clave natural, sin duplicar)
//   3. inserta las reproducciones; las repetidas se ignoran (reproducciones_uq)
// Todo se hace por lotes con unnest(): miles de filas en pocas queries.
export async function importarEventos({ usuarioId, fuente, detalle, eventos, leidas, descartadas }) {
  const resultado = await guardar({ usuarioId, fuente, detalle, eventos, leidas, descartadas });
  // Después de cargar miles de filas, las estadísticas del planificador quedan viejas
  // hasta que corra autovacuum y las vistas wrapped_* pueden elegir planes malísimos.
  // ANALYZE las actualiza en milisegundos (toma una muestra, no lee toda la tabla).
  if (resultado.filas_insertadas > 1000) {
    await query('ANALYZE public.reproducciones, public.canciones, public.artistas, public.playlists');
  }
  return resultado;
}

function guardar({ usuarioId, fuente, detalle, eventos, leidas, descartadas }) {
  return withTransaction(async (client) => {
    const { rows: [imp] } = await client.query(
      `INSERT INTO public.importaciones (usuario_id, fuente, detalle, filas_leidas, filas_descartadas)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [usuarioId, fuente, detalle, leidas, descartadas],
    );

    let insertadas = 0;
    for (let i = 0; i < eventos.length; i += LOTE) {
      insertadas += await importarLote(client, usuarioId, fuente, imp.id, eventos.slice(i, i + LOTE));
    }

    const { rows: [resultado] } = await client.query(
      `UPDATE public.importaciones SET filas_insertadas = $2 WHERE id = $1
       RETURNING id, fuente, detalle, fecha, filas_leidas, filas_insertadas, filas_descartadas`,
      [imp.id, insertadas],
    );
    // Las que ya estaban cargadas no se insertan de nuevo
    resultado.filas_duplicadas = eventos.length - insertadas;
    return resultado;
  });
}

async function importarLote(client, usuarioId, fuente, importacionId, eventos) {
  // 1. Artistas (comparación sin distinguir mayúsculas, la hace PostgreSQL)
  const nombresArtistas = [...new Set(eventos.map((e) => e.artista))];
  await client.query(
    `INSERT INTO public.artistas (nombre)
     SELECT unnest($1::text[]) ON CONFLICT ((lower(nombre))) DO NOTHING`,
    [nombresArtistas],
  );
  const { rows: artistas } = await client.query(
    `SELECT x.n AS original, a.id
       FROM unnest($1::text[]) AS x(n)
       JOIN public.artistas a ON lower(a.nombre) = lower(x.n)`,
    [nombresArtistas],
  );
  const idArtista = new Map(artistas.map((r) => [r.original, r.id]));

  // 2. Álbumes = playlists con es_album = true, únicos por (artista, nombre)
  const clavesAlbum = new Map();
  for (const e of eventos) {
    if (e.album) clavesAlbum.set(`${idArtista.get(e.artista)}|${e.album}`, [idArtista.get(e.artista), e.album]);
  }
  const albumArtistas = [...clavesAlbum.values()].map(([a]) => a);
  const albumNombres = [...clavesAlbum.values()].map(([, n]) => n);
  await client.query(
    `INSERT INTO public.playlists (artista_id, nombre, es_album)
     SELECT a, n, true FROM unnest($1::int[], $2::text[]) AS x(a, n)
     ON CONFLICT (artista_id, (lower(nombre))) WHERE es_album DO NOTHING`,
    [albumArtistas, albumNombres],
  );
  const { rows: albumes } = await client.query(
    `SELECT x.a, x.n, p.id
       FROM unnest($1::int[], $2::text[]) AS x(a, n)
       JOIN public.playlists p ON p.es_album AND p.artista_id = x.a AND lower(p.nombre) = lower(x.n)`,
    [albumArtistas, albumNombres],
  );
  const idAlbum = new Map(albumes.map((r) => [`${r.a}|${r.n}`, r.id]));

  // 3. Canciones, únicas por (artista, nombre). Si ya existían sin álbum o sin URI, se completan.
  const clavesCancion = new Map();
  for (const e of eventos) {
    const a = idArtista.get(e.artista);
    const clave = `${a}|${e.cancion}`;
    const previa = clavesCancion.get(clave);
    clavesCancion.set(clave, {
      a,
      n: e.cancion,
      album: previa?.album ?? (e.album ? idAlbum.get(`${a}|${e.album}`) : null),
      uri: previa?.uri ?? e.spotifyUri,
    });
  }
  const canciones = [...clavesCancion.values()];
  await client.query(
    `INSERT INTO public.canciones (artista_id, nombre, album_id, spotify_uri)
     SELECT DISTINCT ON (a, lower(n)) a, n, al, u
       FROM unnest($1::int[], $2::text[], $3::int[], $4::text[]) AS x(a, n, al, u)
      ORDER BY a, lower(n), al NULLS LAST
     ON CONFLICT (artista_id, (lower(nombre))) DO UPDATE
       SET album_id = COALESCE(canciones.album_id, EXCLUDED.album_id),
           spotify_uri = COALESCE(canciones.spotify_uri, EXCLUDED.spotify_uri)`,
    [canciones.map((c) => c.a), canciones.map((c) => c.n), canciones.map((c) => c.album ?? null), canciones.map((c) => c.uri ?? null)],
  );
  const { rows: idsCanciones } = await client.query(
    `SELECT x.a, x.n, c.id
       FROM unnest($1::int[], $2::text[]) AS x(a, n)
       JOIN public.canciones c ON c.artista_id = x.a AND lower(c.nombre) = lower(x.n)`,
    [canciones.map((c) => c.a), canciones.map((c) => c.n)],
  );
  const idCancion = new Map(idsCanciones.map((r) => [`${r.a}|${r.n}`, r.id]));

  // 4. Reproducciones
  const r = await client.query(
    `INSERT INTO public.reproducciones
       (usuario_id, importacion_id, fuente, cancion_id, fecha_hora, ms_reproducidos, plataforma, aleatorio, salteada)
     SELECT $1, $2, $3, c, f, m, p, al, s
       FROM unnest($4::int[], $5::timestamptz[], $6::int[], $7::text[], $8::bool[], $9::bool[])
            AS x(c, f, m, p, al, s)
     ON CONFLICT (usuario_id, fecha_hora, cancion_id) DO NOTHING`,
    [
      usuarioId, importacionId, fuente,
      eventos.map((e) => idCancion.get(`${idArtista.get(e.artista)}|${e.cancion}`)),
      eventos.map((e) => e.fecha),
      eventos.map((e) => e.ms),
      eventos.map((e) => e.plataforma),
      eventos.map((e) => e.aleatorio),
      eventos.map((e) => e.salteada),
    ],
  );
  return r.rowCount;
}
