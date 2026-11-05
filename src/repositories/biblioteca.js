import { query } from '../db.js';

// Playlists de usuario, favoritos, estados y reseñas. Todas las consultas filtran por
// usuario: nadie puede ver ni tocar lo de otro. Las playlists excluyen a los álbumes (es_album).

// Lo que muestra el front de una canción en cualquier listado
const COLUMNAS_CANCION = `c.id, c.nombre, c.duracion, c.itunes_id, c.portada_url,
            a.id AS artista_id, a.nombre AS artista`;

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
                         'itunes_id', c.itunes_id, 'portada_url', c.portada_url,
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
    `SELECT ${COLUMNAS_CANCION}, f.fecha_agregada
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

// ---------- Biblioteca (estado de cada canción) ----------

export async function listarBiblioteca(usuarioId, { estado, limit, offset }) {
  const { rows } = await query(
    `SELECT ${COLUMNAS_CANCION}, b.estado, b.fecha_actualizacion
       FROM public.biblioteca b
       JOIN public.canciones c ON c.id = b.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE b.usuario_id = $1 AND ($2::text IS NULL OR b.estado = $2)
      ORDER BY b.fecha_actualizacion DESC LIMIT $3 OFFSET $4`,
    [usuarioId, estado ?? null, limit, offset],
  );
  return rows;
}

export async function contarBiblioteca(usuarioId, estado) {
  const { rows } = await query(
    'SELECT count(*) AS total FROM public.biblioteca WHERE usuario_id = $1 AND ($2::text IS NULL OR estado = $2)',
    [usuarioId, estado ?? null],
  );
  return rows[0].total;
}

export async function guardarEnBiblioteca(usuarioId, cancionId, estado) {
  const { rows } = await query(
    `INSERT INTO public.biblioteca (usuario_id, cancion_id, estado) VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id, cancion_id) DO UPDATE
       SET estado = EXCLUDED.estado, fecha_actualizacion = now()
     RETURNING cancion_id, estado, fecha_agregada, fecha_actualizacion`,
    [usuarioId, cancionId, estado],
  );
  return rows[0];
}

export async function quitarDeBiblioteca(usuarioId, cancionId) {
  const { rowCount } = await query(
    'DELETE FROM public.biblioteca WHERE usuario_id = $1 AND cancion_id = $2',
    [usuarioId, cancionId],
  );
  return rowCount;
}

// ---------- Reseñas ----------

export async function listarResenas(usuarioId, { limit, offset }) {
  const { rows } = await query(
    `SELECT ${COLUMNAS_CANCION}, r.puntuacion, r.comentario, r.fecha_actualizacion
       FROM public.resenas r
       JOIN public.canciones c ON c.id = r.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE r.usuario_id = $1
      ORDER BY r.fecha_actualizacion DESC LIMIT $2 OFFSET $3`,
    [usuarioId, limit, offset],
  );
  return rows;
}

export async function contarResenas(usuarioId) {
  const { rows } = await query('SELECT count(*) AS total FROM public.resenas WHERE usuario_id = $1', [usuarioId]);
  return rows[0].total;
}

// Solo cambia lo que llega: guardar la puntuación no borra el comentario, ni al revés.
export async function guardarResena(usuarioId, cancionId, { puntuacion, comentario }) {
  const { rows } = await query(
    `INSERT INTO public.resenas (usuario_id, cancion_id, puntuacion, comentario) VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario_id, cancion_id) DO UPDATE
       SET puntuacion = COALESCE(EXCLUDED.puntuacion, resenas.puntuacion),
           comentario = COALESCE(EXCLUDED.comentario, resenas.comentario),
           fecha_actualizacion = now()
     RETURNING cancion_id, puntuacion, comentario, fecha_creacion, fecha_actualizacion`,
    [usuarioId, cancionId, puntuacion ?? null, comentario ?? null],
  );
  return rows[0];
}

export async function quitarResena(usuarioId, cancionId) {
  const { rowCount } = await query(
    'DELETE FROM public.resenas WHERE usuario_id = $1 AND cancion_id = $2',
    [usuarioId, cancionId],
  );
  return rowCount;
}

// ---------- Relación del usuario con una canción ----------

// Se busca por la clave natural (artista, nombre) porque el front explora la API externa
// y la canción puede venir de una importación. undefined si no está en el catálogo.
export async function relacionConCancion(usuarioId, artista, nombre) {
  const { rows } = await query(
    `SELECT c.id,
            (SELECT b.estado FROM public.biblioteca b
              WHERE b.cancion_id = c.id AND b.usuario_id = $1) AS estado,
            EXISTS (SELECT 1 FROM public.favoritos f
                     WHERE f.cancion_id = c.id AND f.usuario_id = $1) AS favorito,
            (SELECT json_build_object('puntuacion', r.puntuacion, 'comentario', r.comentario)
               FROM public.resenas r
              WHERE r.cancion_id = c.id AND r.usuario_id = $1) AS resena,
            COALESCE((SELECT json_agg(cp.playlist_id)
                        FROM public.canciones_playlists cp
                        JOIN public.playlists p ON p.id = cp.playlist_id
                       WHERE cp.cancion_id = c.id AND p.usuario_id = $1), '[]') AS playlists
       FROM public.canciones c
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE lower(a.nombre) = lower($2) AND lower(c.nombre) = lower($3)`,
    [usuarioId, artista, nombre],
  );
  return rows[0];
}
