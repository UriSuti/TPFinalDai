import { verificarAccessToken } from '../services/tokens.js';
import { forbidden, unauthorized } from '../utils/errors.js';

// Exige "Authorization: Bearer <access token>" válido. Deja req.user = { id, rol }.
export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [tipo, token] = header.split(' ');
  if (tipo !== 'Bearer' || !token) throw unauthorized('Falta el token de acceso');

  try {
    const payload = verificarAccessToken(token);
    req.user = { id: Number(payload.sub), rol: payload.rol };
    next();
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Token vencido' : 'Token inválido');
  }
}

// Usar siempre después de requireAuth.
export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.rol)) throw forbidden();
  next();
};
