import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { unauthorized } from '../utils/errors.js';

// Access token: JWT corto (15 min) que viaja en cada request. No se guarda en la base.
export function firmarAccessToken(usuario) {
  return jwt.sign({ rol: usuario.rol }, config.JWT_SECRET, {
    subject: String(usuario.id),
    expiresIn: config.JWT_ACCESS_TTL,
    algorithm: 'HS256',
  });
}

export function verificarAccessToken(token) {
  // algorithms fijo: evita que alguien mande un token con alg "none" u otro algoritmo.
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Refresh token: string aleatorio opaco (no JWT), de vida larga. En la base solo va su hash,
// así un dump robado de la tabla no sirve para iniciar sesión.
export async function emitirRefreshToken(usuarioId, db = { query }) {
  const token = crypto.randomBytes(48).toString('base64url');
  await db.query(
    `INSERT INTO public.refresh_tokens (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [usuarioId, hash(token), config.REFRESH_TTL_DIAS],
  );
  return token;
}

export async function emitirSesion(usuario, db) {
  return {
    accessToken: firmarAccessToken(usuario),
    refreshToken: await emitirRefreshToken(usuario.id, db),
    tokenType: 'Bearer',
  };
}

// Rotación: el refresh usado se revoca y se entrega uno nuevo.
// Si llega un refresh YA revocado, alguien lo robó y lo reusó: se revocan todas
// las sesiones del usuario (detección de reuso).
export async function rotarRefreshToken(token) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.usuario_id, rt.revocado_en, rt.expira_en < now() AS vencido, u.rol
         FROM public.refresh_tokens rt
         JOIN public.usuarios u ON u.id = rt.usuario_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [hash(token)],
    );
    const fila = rows[0];
    if (!fila) throw unauthorized('Refresh token inválido');

    if (fila.revocado_en) {
      await client.query(
        `UPDATE public.refresh_tokens SET revocado_en = now()
          WHERE usuario_id = $1 AND revocado_en IS NULL`,
        [fila.usuario_id],
      );
      return { reuso: true };
    }
    if (fila.vencido) throw unauthorized('Refresh token vencido');

    await client.query('UPDATE public.refresh_tokens SET revocado_en = now() WHERE id = $1', [fila.id]);
    return { sesion: await emitirSesion({ id: fila.usuario_id, rol: fila.rol }, client) };
  });
}

export async function revocarRefreshToken(token) {
  await query(
    'UPDATE public.refresh_tokens SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL',
    [hash(token)],
  );
}
