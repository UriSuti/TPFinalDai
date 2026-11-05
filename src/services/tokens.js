import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import * as tokensRepository from '../repositories/tokens.js';
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
export async function emitirRefreshToken(usuarioId, db) {
  const token = crypto.randomBytes(48).toString('base64url');
  await tokensRepository.insertar({ usuarioId, tokenHash: hash(token), dias: config.REFRESH_TTL_DIAS }, db);
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
    const fila = await tokensRepository.buscarParaRotar(hash(token), client);
    if (!fila) throw unauthorized('Refresh token inválido');

    if (fila.revocado_en) {
      await tokensRepository.revocarTodos(fila.usuario_id, client);
      return { reuso: true };
    }
    if (fila.vencido) throw unauthorized('Refresh token vencido');

    await tokensRepository.revocar(fila.id, client);
    return { sesion: await emitirSesion({ id: fila.usuario_id, rol: fila.rol }, client) };
  });
}

export async function revocarRefreshToken(token) {
  await tokensRepository.revocarPorHash(hash(token));
}
