import { query } from '../db.js';

// Toda la lógica de las estadísticas está en las vistas wrapped_* del esquema:
// acá solo se filtra por usuario y año.

const top = (vista, usuarioId, anio, limit) => query(
  `SELECT * FROM public.${vista} WHERE usuario_id = $1 AND anio = $2 AND puesto <= $3 ORDER BY puesto LIMIT $3`,
  [usuarioId, anio, limit],
).then((r) => r.rows.map(({ usuario_id, anio: _a, ...resto }) => resto));

export const topCanciones = (usuarioId, anio, limit) => top('wrapped_top_canciones', usuarioId, anio, limit);
export const topArtistas = (usuarioId, anio, limit) => top('wrapped_top_artistas', usuarioId, anio, limit);
export const topGeneros = (usuarioId, anio, limit) => top('wrapped_top_generos', usuarioId, anio, limit);

export async function listarResumenes(usuarioId) {
  const { rows } = await query(
    `SELECT anio, minutos_escuchados, streams, canciones_distintas, artistas_distintos
       FROM public.wrapped_resumen WHERE usuario_id = $1 ORDER BY anio DESC`,
    [usuarioId],
  );
  return rows;
}

export async function obtenerResumen(usuarioId, anio) {
  const { rows } = await query(
    `SELECT minutos_escuchados, streams, canciones_distintas, artistas_distintos
       FROM public.wrapped_resumen WHERE usuario_id = $1 AND anio = $2`,
    [usuarioId, anio],
  );
  return rows[0];
}

export async function habitos(usuarioId, anio) {
  const { rows } = await query(
    'SELECT dia_semana, hora, streams, minutos, salteadas FROM public.wrapped_habitos WHERE usuario_id = $1 AND anio = $2',
    [usuarioId, anio],
  );
  return rows;
}

export async function porMes(usuarioId, anio) {
  const { rows } = await query(
    `SELECT EXTRACT(month FROM fecha_hora_local)::int AS mes,
            round(sum(ms_efectivos) / 60000.0)::int AS minutos,
            count(*) FILTER (WHERE es_stream) AS streams
       FROM public.reproducciones_local
      WHERE usuario_id = $1 AND anio = $2
      GROUP BY 1`,
    [usuarioId, anio],
  );
  return rows;
}

// Last.fm no informa cuánto se escuchó: indica si hay reproducciones sin ms en ese año
export async function hayMinutosEstimados(usuarioId, anio) {
  const { rows } = await query(
    `SELECT COALESCE(bool_or(ms_reproducidos IS NULL), false) AS hay
       FROM public.reproducciones
      WHERE usuario_id = $1
        AND EXTRACT(year FROM fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires') = $2`,
    [usuarioId, anio],
  );
  return rows[0].hay;
}
