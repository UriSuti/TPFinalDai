import { query } from '../db.js';

// Géneros, artistas, álbumes (playlists con es_album = true) y canciones.
// Las funciones que devuelven una fila dan undefined si no existe.

// Escapa % y _ para que la búsqueda los tome literales en ILIKE
const patron = (q) => (q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);

const primera = ({ rows }) => rows[0];

// ---------- Géneros ----------

export async function listarGeneros() {
  const { rows } = await query(
    `SELECT g.id, g.nombre, count(ag.artista_id) AS artistas
       FROM public.generos g LEFT JOIN public.artistas_generos ag ON ag.genero_id = g.id
      GROUP BY g.id ORDER BY artistas DESC, g.nombre`,
  );
  return rows;
}

export const crearGenero = (nombre) => query(
  'INSERT INTO public.generos (nombre) VALUES ($1) RETURNING id, nombre',
  [nombre],
).then(primera);

export const actualizarGenero = (id, nombre) => query(
  'UPDATE public.generos SET nombre = $2 WHERE id = $1 RETURNING id, nombre',
  [id, nombre],
).then(primera);

export const borrarGenero = (id) => query(
  'DELETE FROM public.generos WHERE id = $1 RETURNING id',
  [id],
).then(primera);

// Da de alta los géneros que falten y los vincula al artista (sincronización con Last.fm)
export async function vincularGeneros(artistaId, nombres, db = { query }) {
  await db.query(
    `INSERT INTO public.generos (nombre) SELECT unnest($1::text[])
     ON CONFLICT ((lower(nombre))) DO NOTHING`,
    [nombres],
  );
  await db.query(
    `INSERT INTO public.artistas_generos (artista_id, genero_id)
     SELECT $1, g.id FROM public.generos g WHERE lower(g.nombre) = ANY ($2::text[])
     ON CONFLICT DO NOTHING`,
    [artistaId, nombres],
  );
}

// ---------- Artistas ----------

const WHERE_ARTISTAS = `($1::text IS NULL OR a.nombre ILIKE $1)
    AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM public.artistas_generos ag WHERE ag.artista_id = a.id AND ag.genero_id = $2))`;

export async function listarArtistas({ q, generoId, limit, offset }) {
  const { rows } = await query(
    `SELECT a.id, a.nombre,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'nombre', g.nombre) ORDER BY g.nombre)
                        FROM public.artistas_generos ag JOIN public.generos g ON g.id = ag.genero_id
                       WHERE ag.artista_id = a.id), '[]') AS generos
       FROM public.artistas a WHERE ${WHERE_ARTISTAS}
      ORDER BY a.nombre LIMIT $3 OFFSET $4`,
    [patron(q), generoId ?? null, limit, offset],
  );
  return rows;
}

export async function contarArtistas({ q, generoId }) {
  const { rows } = await query(
    `SELECT count(*) AS total FROM public.artistas a WHERE ${WHERE_ARTISTAS}`,
    [patron(q), generoId ?? null],
  );
  return rows[0].total;
}

export const obtenerArtista = (id) => query(
  `SELECT a.id, a.nombre, a.generos_sincronizados_en,
          COALESCE((SELECT json_agg(json_build_object('id', g.id, 'nombre', g.nombre) ORDER BY g.nombre)
                      FROM public.artistas_generos ag JOIN public.generos g ON g.id = ag.genero_id
                     WHERE ag.artista_id = a.id), '[]') AS generos,
          COALESCE((SELECT json_agg(json_build_object('id', p.id, 'nombre', p.nombre,
                                                      'fecha_lanzamiento', p.fecha_lanzamiento)
                                    ORDER BY p.fecha_lanzamiento NULLS LAST, p.nombre)
                      FROM public.playlists p WHERE p.es_album AND p.artista_id = a.id), '[]') AS albumes,
          (SELECT count(*) FROM public.canciones c WHERE c.artista_id = a.id) AS canciones
     FROM public.artistas a WHERE a.id = $1`,
  [id],
).then(primera);

export const crearArtista = (nombre) => query(
  'INSERT INTO public.artistas (nombre) VALUES ($1) RETURNING id, nombre',
  [nombre],
).then(primera);

export const actualizarArtista = (id, nombre) => query(
  'UPDATE public.artistas SET nombre = $2 WHERE id = $1 RETURNING id, nombre',
  [id, nombre],
).then(primera);

export const borrarArtista = (id) => query(
  'DELETE FROM public.artistas WHERE id = $1 RETURNING id',
  [id],
).then(primera);

// Bloquea la fila hasta el fin de la transacción. Devuelve si el artista existe.
export async function bloquearArtista(id, db) {
  const { rowCount } = await db.query('SELECT 1 FROM public.artistas WHERE id = $1 FOR UPDATE', [id]);
  return rowCount > 0;
}

export async function reemplazarGeneros(artistaId, generoIds, db) {
  await db.query('DELETE FROM public.artistas_generos WHERE artista_id = $1', [artistaId]);
  await db.query(
    `INSERT INTO public.artistas_generos (artista_id, genero_id)
     SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
    [artistaId, generoIds],
  );
}

export async function marcarGenerosSincronizados(artistaId, db = { query }) {
  await db.query('UPDATE public.artistas SET generos_sincronizados_en = now() WHERE id = $1', [artistaId]);
}

// Artistas sin sincronizar. Con usuarioId, solo los que ese usuario escuchó.
export async function artistasSinSincronizar(limite, usuarioId) {
  const { rows } = await query(
    `SELECT a.id, a.nombre
       FROM public.artistas a
      WHERE a.generos_sincronizados_en IS NULL
        AND ($2::int IS NULL OR EXISTS (
              SELECT 1 FROM public.reproducciones r
                JOIN public.canciones c ON c.id = r.cancion_id
               WHERE c.artista_id = a.id AND r.usuario_id = $2))
      ORDER BY a.id
      LIMIT $1`,
    [limite, usuarioId ?? null],
  );
  return rows;
}

export async function contarArtistasSinSincronizar() {
  const { rows } = await query(
    'SELECT count(*) AS pendientes FROM public.artistas WHERE generos_sincronizados_en IS NULL',
  );
  return rows[0].pendientes;
}

// ---------- Álbumes ----------

export const obtenerAlbum = (id) => query(
  `SELECT p.id, p.nombre, p.fecha_lanzamiento, d.duracion,
          json_build_object('id', a.id, 'nombre', a.nombre) AS artista,
          COALESCE((SELECT json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'duracion', EXTRACT(epoch FROM c.duracion)::int) ORDER BY c.id)
                      FROM public.canciones c WHERE c.album_id = p.id), '[]') AS canciones
     FROM public.playlists p
     JOIN public.artistas a ON a.id = p.artista_id
     JOIN public.playlists_duracion d ON d.id = p.id
    WHERE p.id = $1 AND p.es_album`,
  [id],
).then(primera);

export const crearAlbum = ({ nombre, artistaId, fechaLanzamiento }) => query(
  `INSERT INTO public.playlists (nombre, es_album, artista_id, fecha_lanzamiento)
   VALUES ($1, true, $2, $3) RETURNING id, nombre, artista_id, fecha_lanzamiento`,
  [nombre, artistaId, fechaLanzamiento ?? null],
).then(primera);

// Solo cambia los campos presentes en `b`; fechaLanzamiento: null borra la fecha.
export const actualizarAlbum = (id, b) => query(
  `UPDATE public.playlists
      SET nombre = COALESCE($2, nombre),
          fecha_lanzamiento = CASE WHEN $4 THEN $3::date ELSE fecha_lanzamiento END
    WHERE id = $1 AND es_album
    RETURNING id, nombre, artista_id, fecha_lanzamiento`,
  [id, b.nombre ?? null, b.fechaLanzamiento ?? null, 'fechaLanzamiento' in b],
).then(primera);

export const borrarAlbum = (id) => query(
  'DELETE FROM public.playlists WHERE id = $1 AND es_album RETURNING id',
  [id],
).then(primera);

// ---------- Canciones ----------

const SELECT_CANCION = `
  SELECT c.id, c.nombre, c.duracion, c.spotify_uri, c.itunes_id, c.portada_url,
         json_build_object('id', a.id, 'nombre', a.nombre) AS artista,
         CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'nombre', p.nombre) END AS album
    FROM public.canciones c
    JOIN public.artistas a ON a.id = c.artista_id
    LEFT JOIN public.playlists p ON p.id = c.album_id`;

const WHERE_CANCIONES = '($1::text IS NULL OR c.nombre ILIKE $1 OR a.nombre ILIKE $1) AND ($2::int IS NULL OR c.artista_id = $2)';

export async function listarCanciones({ q, artistaId, limit, offset }) {
  const { rows } = await query(
    `${SELECT_CANCION} WHERE ${WHERE_CANCIONES} ORDER BY a.nombre, c.nombre LIMIT $3 OFFSET $4`,
    [patron(q), artistaId ?? null, limit, offset],
  );
  return rows;
}

export async function contarCanciones({ q, artistaId }) {
  const { rows } = await query(
    `SELECT count(*) AS total FROM public.canciones c JOIN public.artistas a ON a.id = c.artista_id WHERE ${WHERE_CANCIONES}`,
    [patron(q), artistaId ?? null],
  );
  return rows[0].total;
}

export const obtenerCancion = (id) => query(`${SELECT_CANCION} WHERE c.id = $1`, [id]).then(primera);

export const crearCancion = ({ nombre, artistaId, albumId, duracionSegundos }) => query(
  `INSERT INTO public.canciones (nombre, artista_id, album_id, duracion)
   VALUES ($1, $2, $3, make_interval(secs => $4)) RETURNING id`,
  [nombre, artistaId, albumId ?? null, duracionSegundos ?? null],
).then(primera);

// Alta idempotente por clave natural (artista, nombre). Si ya existía (por ejemplo, importada),
// solo se completa lo que le faltaba: nunca se pisan datos.
export const resolverCancion = ({ nombre, artistaId, albumId, duracionSegundos, itunesId, portadaUrl }, db) => db.query(
  `INSERT INTO public.canciones (nombre, artista_id, album_id, duracion, itunes_id, portada_url)
   VALUES ($1, $2, $3, make_interval(secs => $4), $5, $6)
   ON CONFLICT (artista_id, (lower(nombre))) DO UPDATE
     SET album_id = COALESCE(canciones.album_id, EXCLUDED.album_id),
         duracion = COALESCE(canciones.duracion, EXCLUDED.duracion),
         itunes_id = COALESCE(canciones.itunes_id, EXCLUDED.itunes_id),
         portada_url = COALESCE(canciones.portada_url, EXCLUDED.portada_url)
   RETURNING id`,
  [nombre, artistaId, albumId ?? null, duracionSegundos ?? null, itunesId ?? null, portadaUrl ?? null],
).then(primera);

// Solo cambia los campos presentes en `b`; albumId o duracionSegundos en null los borran.
export const actualizarCancion = (id, b) => query(
  `UPDATE public.canciones
      SET nombre     = COALESCE($2, nombre),
          artista_id = COALESCE($3, artista_id),
          album_id   = CASE WHEN $6 THEN $4::int ELSE album_id END,
          duracion   = CASE WHEN $7 THEN make_interval(secs => $5) ELSE duracion END
    WHERE id = $1 RETURNING id`,
  [id, b.nombre ?? null, b.artistaId ?? null, b.albumId ?? null,
    b.duracionSegundos ?? null, 'albumId' in b, 'duracionSegundos' in b],
).then(primera);

export const borrarCancion = (id) => query(
  'DELETE FROM public.canciones WHERE id = $1 RETURNING id',
  [id],
).then(primera);
