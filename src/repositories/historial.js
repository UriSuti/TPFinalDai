import { query } from '../db.js';

// Historial de escucha: reproducciones e importaciones de un usuario.

// ---------- Reproducciones ----------

const WHERE_REPRODUCCIONES = `r.usuario_id = $1 AND ($2::timestamptz IS NULL OR r.fecha_hora >= $2)
                 AND ($3::timestamptz IS NULL OR r.fecha_hora < $3)`;

export async function listarReproducciones({ usuarioId, desde, hasta, limit, offset }) {
  const { rows } = await query(
    `SELECT r.id, r.fecha_hora, r.ms_reproducidos, r.fuente, r.plataforma, r.aleatorio, r.salteada,
            c.id AS cancion_id, c.nombre AS cancion, a.id AS artista_id, a.nombre AS artista
       FROM public.reproducciones r
       JOIN public.canciones c ON c.id = r.cancion_id
       JOIN public.artistas a ON a.id = c.artista_id
      WHERE ${WHERE_REPRODUCCIONES}
      ORDER BY r.fecha_hora DESC LIMIT $4 OFFSET $5`,
    [usuarioId, desde ?? null, hasta ?? null, limit, offset],
  );
  return rows;
}

export async function contarReproducciones({ usuarioId, desde, hasta }) {
  const { rows } = await query(
    `SELECT count(*) AS total FROM public.reproducciones r WHERE ${WHERE_REPRODUCCIONES}`,
    [usuarioId, desde ?? null, hasta ?? null],
  );
  return rows[0].total;
}

export async function crearReproduccion({ usuarioId, cancionId, fechaHora, msReproducidos }) {
  const { rows } = await query(
    `INSERT INTO public.reproducciones (usuario_id, cancion_id, fuente, fecha_hora, ms_reproducidos)
     VALUES ($1, $2, 'manual', COALESCE($3::timestamptz, now()), $4)
     RETURNING id, cancion_id, fuente, fecha_hora, ms_reproducidos`,
    [usuarioId, cancionId, fechaHora ?? null, msReproducidos ?? null],
  );
  return rows[0];
}

export async function borrarReproduccion(id, usuarioId) {
  const { rowCount } = await query(
    'DELETE FROM public.reproducciones WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  return rowCount;
}

// Fecha del último scrobble importado (null si no hay ninguno)
export async function ultimaFechaLastfm(usuarioId) {
  const { rows } = await query(
    `SELECT max(fecha_hora) AS fecha FROM public.reproducciones WHERE usuario_id = $1 AND fuente = 'lastfm'`,
    [usuarioId],
  );
  return rows[0].fecha;
}

// ---------- Importaciones ----------

export async function listarImportaciones(usuarioId) {
  const { rows } = await query(
    `SELECT id, fuente, detalle, fecha, filas_leidas, filas_insertadas, filas_descartadas
       FROM public.importaciones WHERE usuario_id = $1 ORDER BY fecha DESC`,
    [usuarioId],
  );
  return rows;
}

// Por CASCADE también se borran todas sus reproducciones
export async function borrarImportacion(id, usuarioId) {
  const { rowCount } = await query(
    'DELETE FROM public.importaciones WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  return rowCount;
}
