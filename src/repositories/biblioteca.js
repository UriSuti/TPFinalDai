import { query } from '../db.js';

// Playlists de usuario y favoritos. Todas las consultas filtran por usuario: nadie
// puede ver ni tocar lo de otro. Las playlists excluyen a los álbumes (es_album).

// ---------- Playlists ----------

export async function esPlaylistPropia(id, usuarioId) {
  const { rows } = await query(
    'SELECT id FROM public.playlists WHERE id = $1 AND usuario_id = $2 AND NOT es_album',
    [id, usuarioId],
  );
  return rows.length > 0;
}

export async function listarPlaylists(usuarioId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.fecha_creacion, d.duracion,
            (SELECT count(*) FROM public.canciones_playlists cp WHERE cp.playlist_id = p.id) AS canciones
       FROM public.playlists p JOIN public.playlists_duracion d ON d.id = p.id
      WHERE p.usuario_id = $1 AND NOT p.es_album
      ORDER BY p.fecha_creacion DESC`,
    [usuarioId],
  );
  return rows;
}

export async function crearPlaylist(usuarioId, nombre) {
  const { rows } = await query(
    `INSERT INTO public.playlists (nombre, usuario_id) VALUES ($1, $2)
     RETURNING id, nombre, fecha_creacion`,
    [nombre, usuarioId],
  );
  return rows[0];
}

export async function obtenerPlaylist(id, usuarioId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.fecha_creacion, d.duracion,
            COALESCE((SELECT json_agg(json_build_object(
                         'id', c.id, 'nombre', c.nombre, 'duracion', EXTRACT(epoch FROM c.duracion)::int,
                         'artista', a.nombre, 'fecha_agregada', cp.fecha_agregada)
                       ORDER BY cp.fecha_agregada)
                        FROM public.canciones_playlists cp
                        JOIN public.canciones c ON c.id = cp.cancion_id
                        JOIN public.artistas a ON a.id = c.artista_id
                       WHERE cp.playlist_id = p.id), '[]') AS canciones
       FROM public.playlists p JOIN public.playlists_duracion d ON d.id = p.id
      WHERE p.id = $1 AND p.usuario_id = $2 AND NOT p.es_album`,
    [id, usuarioId],
  );
  return rows[0];
}

export async function renombrarPlaylist(id, usuarioId, nombre) {
  const { rows } = await query(
    `UPDATE public.playlists SET nombre = $3
      WHERE id = $1 AND usuario_id = $2 AND NOT es_album
      RETURNING id, nombre, fecha_creacion`,
    [id, usuarioId, nombre],
  );
  return rows[0];
}

// Las funciones de borrado y alta idempotente devuelven cuántas filas tocaron.
export async function borrarPlaylist(id, usuarioId) {
  const { rowCount } = await query(
    'DELETE FROM public.playlists WHERE id = $1 AND usuario_id = $2 AND NOT es_album',
    [id, usuarioId],
  );
  return rowCount;
}

export async function agregarCancion(playlistId, cancionId) {
  const { rowCount } = await query(
    `INSERT INTO public.canciones_playlists (playlist_id, cancion_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [playlistId, cancionId],
  );
  return rowCount;
}

export async function quitarCancion(playlistId, cancionId) {
  const { rowCount } = await query(
    'DELETE FROM public.canciones_playlists WHERE playlist_id = $1 AND cancion_id = $2',
    [playlistId, cancionId],
  );
  return rowCount;
}

// ---------- Favoritos ----------

export async function listarFavoritos(usuarioId, { limit, offset }) {
  const { rows } = await query(
    `SELECT c.id, c.nombre, c.duracion, a.id AS artista_id, a.nombre AS artista, f.fecha_agregada
       FROM public.favoritos f
       JOIN public.canciones c ON c.id = f.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE f.usuario_id = $1
      ORDER BY f.fecha_agregada DESC LIMIT $2 OFFSET $3`,
    [usuarioId, limit, offset],
  );
  return rows;
}

export async function contarFavoritos(usuarioId) {
  const { rows } = await query('SELECT count(*) AS total FROM public.favoritos WHERE usuario_id = $1', [usuarioId]);
  return rows[0].total;
}

export async function agregarFavorito(usuarioId, cancionId) {
  const { rowCount } = await query(
    'INSERT INTO public.favoritos (usuario_id, cancion_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [usuarioId, cancionId],
  );
  return rowCount;
}

export async function quitarFavorito(usuarioId, cancionId) {
  const { rowCount } = await query(
    'DELETE FROM public.favoritos WHERE usuario_id = $1 AND cancion_id = $2',
    [usuarioId, cancionId],
  );
  return rowCount;
}
