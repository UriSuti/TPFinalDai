import { query } from '../db.js';

// SQL de la carga por lotes: miles de filas en pocas queries con unnest().
// Salvo analizar(), todo corre dentro de la transacción de la importación (`db`).

export async function crearImportacion({ usuarioId, fuente, detalle, leidas, descartadas }, db) {
  const { rows } = await db.query(
    `INSERT INTO public.importaciones (usuario_id, fuente, detalle, filas_leidas, filas_descartadas)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [usuarioId, fuente, detalle, leidas, descartadas],
  );
  return rows[0];
}

export async function finalizarImportacion(id, insertadas, db) {
  const { rows } = await db.query(
    `UPDATE public.importaciones SET filas_insertadas = $2 WHERE id = $1
     RETURNING id, fuente, detalle, fecha, filas_leidas, filas_insertadas, filas_descartadas`,
    [id, insertadas],
  );
  return rows[0];
}

// Comparación sin distinguir mayúsculas, la hace PostgreSQL
export async function insertarArtistas(nombres, db) {
  await db.query(
    `INSERT INTO public.artistas (nombre)
     SELECT unnest($1::text[]) ON CONFLICT ((lower(nombre))) DO NOTHING`,
    [nombres],
  );
}

export async function idsDeArtistas(nombres, db) {
  const { rows } = await db.query(
    `SELECT x.n AS original, a.id
       FROM unnest($1::text[]) AS x(n)
       JOIN public.artistas a ON lower(a.nombre) = lower(x.n)`,
    [nombres],
  );
  return rows;
}

// Álbumes = playlists con es_album = true, únicos por (artista, nombre)
export async function insertarAlbumes(artistaIds, nombres, db) {
  await db.query(
    `INSERT INTO public.playlists (artista_id, nombre, es_album)
     SELECT a, n, true FROM unnest($1::int[], $2::text[]) AS x(a, n)
     ON CONFLICT (artista_id, (lower(nombre))) WHERE es_album DO NOTHING`,
    [artistaIds, nombres],
  );
}

export async function idsDeAlbumes(artistaIds, nombres, db) {
  const { rows } = await db.query(
    `SELECT x.a, x.n, p.id
       FROM unnest($1::int[], $2::text[]) AS x(a, n)
       JOIN public.playlists p ON p.es_album AND p.artista_id = x.a AND lower(p.nombre) = lower(x.n)`,
    [artistaIds, nombres],
  );
  return rows;
}

// Canciones, únicas por (artista, nombre). Si ya existían sin álbum o sin URI, se completan.
export async function insertarCanciones(canciones, db) {
  await db.query(
    `INSERT INTO public.canciones (artista_id, nombre, album_id, spotify_uri)
     SELECT DISTINCT ON (a, lower(n)) a, n, al, u
       FROM unnest($1::int[], $2::text[], $3::int[], $4::text[]) AS x(a, n, al, u)
      ORDER BY a, lower(n), al NULLS LAST
     ON CONFLICT (artista_id, (lower(nombre))) DO UPDATE
       SET album_id = COALESCE(canciones.album_id, EXCLUDED.album_id),
           spotify_uri = COALESCE(canciones.spotify_uri, EXCLUDED.spotify_uri)`,
    [canciones.map((c) => c.a), canciones.map((c) => c.n), canciones.map((c) => c.album ?? null), canciones.map((c) => c.uri ?? null)],
  );
}

export async function idsDeCanciones(canciones, db) {
  const { rows } = await db.query(
    `SELECT x.a, x.n, c.id
       FROM unnest($1::int[], $2::text[]) AS x(a, n)
       JOIN public.canciones c ON c.artista_id = x.a AND lower(c.nombre) = lower(x.n)`,
    [canciones.map((c) => c.a), canciones.map((c) => c.n)],
  );
  return rows;
}

// Las repetidas se ignoran (reproducciones_uq). Devuelve cuántas se insertaron.
export async function insertarReproducciones({ usuarioId, importacionId, fuente, reproducciones }, db) {
  const { rowCount } = await db.query(
    `INSERT INTO public.reproducciones
       (usuario_id, importacion_id, fuente, cancion_id, fecha_hora, ms_reproducidos, plataforma, aleatorio, salteada)
     SELECT $1, $2, $3, c, f, m, p, al, s
       FROM unnest($4::int[], $5::timestamptz[], $6::int[], $7::text[], $8::bool[], $9::bool[])
            AS x(c, f, m, p, al, s)
     ON CONFLICT (usuario_id, fecha_hora, cancion_id) DO NOTHING`,
    [
      usuarioId, importacionId, fuente,
      reproducciones.map((r) => r.cancionId),
      reproducciones.map((r) => r.fecha),
      reproducciones.map((r) => r.ms),
      reproducciones.map((r) => r.plataforma),
      reproducciones.map((r) => r.aleatorio),
      reproducciones.map((r) => r.salteada),
    ],
  );
  return rowCount;
}

// ANALYZE actualiza las estadísticas en milisegundos (toma una muestra, no lee toda la tabla).
export async function analizar() {
  await query('ANALYZE public.reproducciones, public.canciones, public.artistas, public.playlists');
}
