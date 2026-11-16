import { query } from '../db.js';

// Estadísticas de la biblioteca personal (estados, favoritos, reseñas, playlists y actividad).
// Todo se calcula en cada request con los datos guardados: no hay nada precalculado.
// Las del historial de escucha están en repositories/wrapped.js.

const TZ = 'America/Argentina/Buenos_Aires';

// Canciones que el usuario guardó de alguna forma: en la biblioteca o como favoritas
const MIAS = `
  SELECT cancion_id FROM public.biblioteca WHERE usuario_id = $1
  UNION
  SELECT cancion_id FROM public.favoritos WHERE usuario_id = $1`;

export async function porEstado(usuarioId) {
  const { rows } = await query(
    'SELECT estado, count(*) AS cantidad FROM public.biblioteca WHERE usuario_id = $1 GROUP BY estado',
    [usuarioId],
  );
  return rows;
}

export async function totales(usuarioId) {
  const { rows } = await query(
    `SELECT
        (SELECT count(*) FROM public.favoritos WHERE usuario_id = $1) AS favoritos,
        (SELECT count(*) FROM public.playlists WHERE usuario_id = $1 AND NOT es_album) AS playlists,
        (SELECT count(*) FROM public.canciones_playlists cp
           JOIN public.playlists p ON p.id = cp.playlist_id
          WHERE p.usuario_id = $1) AS canciones_en_playlists,
        (SELECT count(DISTINCT c.artista_id) FROM (${MIAS}) m
           JOIN public.canciones c ON c.id = m.cancion_id) AS artistas_distintos,
        (SELECT count(*) FROM public.biblioteca
          WHERE usuario_id = $1 AND estado = 'escuchado'
            AND EXTRACT(year FROM fecha_actualizacion AT TIME ZONE '${TZ}')
              = EXTRACT(year FROM now() AT TIME ZONE '${TZ}')) AS escuchadas_este_anio`,
    [usuarioId],
  );
  return rows[0];
}

export async function resenas(usuarioId) {
  const { rows } = await query(
    `SELECT count(*) AS total,
            count(puntuacion) AS puntuadas,
            count(comentario) AS con_comentario,
            round(avg(puntuacion), 2) AS promedio
       FROM public.resenas WHERE usuario_id = $1`,
    [usuarioId],
  );
  return rows[0];
}

// Cuántas reseñas tienen cada puntuación (1 a 5), incluyendo las que tienen 0
export async function distribucionPuntuaciones(usuarioId) {
  const { rows } = await query(
    `SELECT p AS puntuacion, count(r.puntuacion) AS cantidad
       FROM generate_series(1, 5) p
       LEFT JOIN public.resenas r ON r.puntuacion = p AND r.usuario_id = $1
      GROUP BY p ORDER BY p`,
    [usuarioId],
  );
  return rows;
}

export async function topArtistas(usuarioId, limit = 5) {
  const { rows } = await query(
    `SELECT a.id AS artista_id, a.nombre AS artista, count(*) AS canciones,
            round(avg(r.puntuacion), 1) AS puntuacion_promedio
       FROM (${MIAS}) m
       JOIN public.canciones c ON c.id = m.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
       LEFT JOIN public.resenas r ON r.cancion_id = c.id AND r.usuario_id = $1
      GROUP BY a.id, a.nombre
      ORDER BY canciones DESC, a.nombre
      LIMIT $2`,
    [usuarioId, limit],
  );
  return rows;
}

// Porcentaje sobre las canciones guardadas. Un artista puede tener varios géneros.
export async function topGeneros(usuarioId, limit = 5) {
  const { rows } = await query(
    `WITH mias AS (${MIAS})
     SELECT g.id AS genero_id, g.nombre AS genero, count(DISTINCT m.cancion_id) AS canciones,
            round(100.0 * count(DISTINCT m.cancion_id) / NULLIF((SELECT count(*) FROM mias), 0), 1) AS porcentaje
       FROM mias m
       JOIN public.canciones c ON c.id = m.cancion_id
       JOIN public.artistas_generos ag ON ag.artista_id = c.artista_id
       JOIN public.generos g ON g.id = ag.genero_id
      GROUP BY g.id, g.nombre
      ORDER BY canciones DESC, g.nombre
      LIMIT $2`,
    [usuarioId, limit],
  );
  return rows;
}

export async function mejorPuntuadas(usuarioId, limit = 5) {
  const { rows } = await query(
    `SELECT c.id, c.nombre, a.nombre AS artista, c.itunes_id, c.portada_url, r.puntuacion
       FROM public.resenas r
       JOIN public.canciones c ON c.id = r.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE r.usuario_id = $1 AND r.puntuacion IS NOT NULL
      ORDER BY r.puntuacion DESC, r.fecha_actualizacion DESC
      LIMIT $2`,
    [usuarioId, limit],
  );
  return rows;
}

// Acciones por mes en los últimos 6 meses (los meses sin actividad aparecen con 0)
export async function actividadPorMes(usuarioId) {
  const { rows } = await query(
    `SELECT to_char(m, 'YYYY-MM') AS mes, count(ac.id) AS acciones
       FROM generate_series(
              date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '5 months',
              date_trunc('month', now() AT TIME ZONE '${TZ}'),
              interval '1 month') m
       LEFT JOIN public.actividad ac
              ON ac.usuario_id = $1 AND date_trunc('month', ac.fecha AT TIME ZONE '${TZ}') = m
      GROUP BY m ORDER BY m`,
    [usuarioId],
  );
  return rows;
}

export async function diasActivos(usuarioId, dias = 30) {
  const { rows } = await query(
    `SELECT count(DISTINCT (fecha AT TIME ZONE '${TZ}')::date) AS dias
       FROM public.actividad
      WHERE usuario_id = $1 AND fecha > now() - make_interval(days => $2)`,
    [usuarioId, dias],
  );
  return rows[0].dias;
}
