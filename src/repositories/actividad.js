import { query } from '../db.js';

// Registro de actividad del usuario. registrar recibe `db` para poder ir dentro de la misma
// transacción que la acción que se registra: si una falla, no queda ninguna de las dos.

export async function registrar({ usuarioId, tipo, cancionId = null, playlistId = null, detalle = {} }, db = { query }) {
  await db.query(
    `INSERT INTO public.actividad (usuario_id, tipo, cancion_id, playlist_id, detalle)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [usuarioId, tipo, cancionId, playlistId, JSON.stringify(detalle)],
  );
}

// LEFT JOIN: si la canción ya no existe, la actividad se muestra igual con lo que hay en detalle.
export async function listar(usuarioId, { tipo, limit, offset }) {
  const { rows } = await query(
    `SELECT ac.id, ac.tipo, ac.fecha, ac.detalle, ac.playlist_id,
            CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
              'id', c.id, 'nombre', c.nombre, 'artista', a.nombre,
              'itunes_id', c.itunes_id, 'portada_url', c.portada_url) END AS cancion
       FROM public.actividad ac
       LEFT JOIN public.canciones c ON c.id = ac.cancion_id
       LEFT JOIN public.artistas a ON a.id = c.artista_id
      WHERE ac.usuario_id = $1 AND ($2::text IS NULL OR ac.tipo LIKE $2 || '%')
      ORDER BY ac.fecha DESC, ac.id DESC
      LIMIT $3 OFFSET $4`,
    [usuarioId, tipo ?? null, limit, offset],
  );
  return rows;
}

export async function contar(usuarioId, tipo) {
  const { rows } = await query(
    `SELECT count(*) AS total FROM public.actividad
      WHERE usuario_id = $1 AND ($2::text IS NULL OR tipo LIKE $2 || '%')`,
    [usuarioId, tipo ?? null],
  );
  return rows[0].total;
}
