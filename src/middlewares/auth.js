import { verificarAccessToken } from '../services/tokens.js';
import { borrarCookieSesion, COOKIE_SESION } from '../utils/cookieSesion.js';
import { forbidden, unauthorized } from '../utils/errors.js';

function leerBearer(req) {
  const [tipo, token] = (req.get('authorization') ?? '').split(' ');
  return tipo === 'Bearer' ? token : undefined;
}

// Exige un access token válido: el de la cookie de sesión (navegador) o el del header
// "Authorization: Bearer" (otros clientes). Deja req.user = { id, rol }.
export function requireAuth(req, res, next) {
  const bearer = leerBearer(req);
  const token = bearer || req.cookies?.[COOKIE_SESION];
  if (!token) throw unauthorized('Falta el token de acceso', 'TOKEN_AUSENTE');

  let payload;
  try {
    payload = verificarAccessToken(token);
  } catch (err) {
    // JavaScript no puede borrar una cookie HttpOnly: si ya no sirve, la borra el server.
    if (!bearer) borrarCookieSesion(res);
    throw err.name === 'TokenExpiredError'
      ? unauthorized('Token vencido', 'TOKEN_VENCIDO')
      : unauthorized('Token inválido', 'TOKEN_INVALIDO');
  }

  req.user = { id: Number(payload.sub), rol: payload.rol };
  next();
}

// Usar siempre después de requireAuth.
export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.rol)) throw forbidden();
  next();
};
