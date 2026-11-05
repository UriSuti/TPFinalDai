import { query } from '../db.js';

// Acceso a la tabla refresh_tokens. Acá solo se manejan hashes, nunca el token.

export async function insertar({ usuarioId, tokenHash, dias }, db = { query }) {
  await db.query(
    `INSERT INTO public.refresh_tokens (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [usuarioId, tokenHash, dias],
  );
}

// Bloquea la fila (FOR UPDATE): solo tiene sentido dentro de una transacción.
export async function buscarParaRotar(tokenHash, db) {
  const { rows } = await db.query(
    `SELECT rt.id, rt.usuario_id, rt.revocado_en, rt.expira_en < now() AS vencido, u.rol
       FROM public.refresh_tokens rt
       JOIN public.usuarios u ON u.id = rt.usuario_id
      WHERE rt.token_hash = $1
      FOR UPDATE OF rt`,
    [tokenHash],
  );
  return rows[0];
}

export async function revocar(id, db = { query }) {
  await db.query('UPDATE public.refresh_tokens SET revocado_en = now() WHERE id = $1', [id]);
}

export async function revocarPorHash(tokenHash) {
  await query(
    'UPDATE public.refresh_tokens SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL',
    [tokenHash],
  );
}

export async function revocarTodos(usuarioId, db = { query }) {
  await db.query(
    `UPDATE public.refresh_tokens SET revocado_en = now()
      WHERE usuario_id = $1 AND revocado_en IS NULL`,
    [usuarioId],
  );
}
