import { query } from '../db.js';

// Acceso a la tabla usuarios. Las funciones que pueden ser parte de una transacción
// reciben `db` (el client de withTransaction); por defecto usan el pool.

const COLUMNAS = 'id, nombre, apellido, email, rol, lastfm_usuario, avatar_url, bio, generos_preferidos, artistas_preferidos, fecha_registro';

// Devuelve undefined si el email ya está registrado
export async function crear({ nombre, apellido, email, passwordHash }, db = { query }) {
  const { rows } = await db.query(
    `INSERT INTO public.usuarios (nombre, apellido, email, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING ${COLUMNAS}`,
    [nombre, apellido, email, passwordHash],
  );
  return rows[0];
}

export async function buscarPorEmailConHash(email) {
  const { rows } = await query(
    `SELECT ${COLUMNAS}, password_hash FROM public.usuarios WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0];
}

export async function buscarPorId(id) {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM public.usuarios WHERE id = $1`, [id]);
  return rows[0];
}

export async function obtenerPasswordHash(id) {
  const { rows } = await query('SELECT password_hash FROM public.usuarios WHERE id = $1', [id]);
  return rows[0]?.password_hash;
}

export async function actualizarPerfil(id, datos) {
  const campos = Object.entries(datos).map(([key, value]) => {
    if (key === 'generos_preferidos' || key === 'artistas_preferidos') {
      return [key, JSON.stringify(value ?? [])];
    }
    return [key, value];
  });
  const set = campos.map(([k], i) => {
    if (k === 'generos_preferidos' || k === 'artistas_preferidos') {
      return `${k} = $${i + 2}::jsonb`;
    }
    return `${k} = $${i + 2}`;
  }).join(', ');
  const { rows } = await query(
    `UPDATE public.usuarios SET ${set} WHERE id = $1 RETURNING ${COLUMNAS}`,
    [id, ...campos.map(([, v]) => v)],
  );
  return rows[0];
}

export async function actualizarPassword(id, passwordHash, db = { query }) {
  await db.query('UPDATE public.usuarios SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

// CASCADE: se borran playlists, favoritos, reproducciones, importaciones y tokens
export async function borrar(id) {
  await query('DELETE FROM public.usuarios WHERE id = $1', [id]);
}

export async function obtenerUsuarioLastfm(id) {
  const { rows } = await query('SELECT lastfm_usuario FROM public.usuarios WHERE id = $1', [id]);
  return rows[0]?.lastfm_usuario;
}

export async function guardarUsuarioLastfm(id, usuarioLastfm) {
  await query('UPDATE public.usuarios SET lastfm_usuario = $2 WHERE id = $1', [id, usuarioLastfm]);
}
