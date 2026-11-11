import { query } from '../db.js';

const COLUMNAS = 'usuario_id, tipo, item_id, puntuacion, comentario, fecha_creacion, fecha_actualizacion';

export async function listarPorUsuario(usuarioId, tipo = null) {
  const params = [usuarioId];
  const where = tipo ? 'AND tipo = $2' : '';
  if (tipo) params.push(tipo);

  const { rows } = await query(
    `SELECT ${COLUMNAS}
       FROM public.puntuaciones
      WHERE usuario_id = $1 ${where}
      ORDER BY tipo, item_id`,
    params,
  );
  return rows;
}

export async function obtener(usuarioId, tipo, itemId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS}
       FROM public.puntuaciones
      WHERE usuario_id = $1 AND tipo = $2 AND item_id = $3`,
    [usuarioId, tipo, itemId],
  );
  return rows[0];
}

export async function crearOActualizar({ usuarioId, tipo, itemId, puntuacion, comentario }, db = { query }) {
  const { rows } = await db.query(
    `INSERT INTO public.puntuaciones (usuario_id, tipo, item_id, puntuacion, comentario)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario_id, tipo, item_id)
     DO UPDATE SET puntuacion = EXCLUDED.puntuacion,
                   comentario = EXCLUDED.comentario,
                   fecha_actualizacion = now()
     RETURNING ${COLUMNAS}`,
    [usuarioId, tipo, itemId, puntuacion, comentario ?? null],
  );
  return rows[0];
}

export async function borrar(usuarioId, tipo, itemId, db = { query }) {
  const { rows } = await db.query(
    `DELETE FROM public.puntuaciones
      WHERE usuario_id = $1 AND tipo = $2 AND item_id = $3
      RETURNING ${COLUMNAS}`,
    [usuarioId, tipo, itemId],
  );
  return rows[0];
}
