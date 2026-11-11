import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// El JWT del navegador viaja en esta cookie. HttpOnly: JavaScript no puede leerla, así un XSS
// no se lleva el token. La expiración la sigue validando el server en cada request.
export const COOKIE_SESION = 'sesion';

// La cookie sobrevive un día al JWT: así, al volver con la sesión vencida, el server puede
// responder "Token vencido" (y el front avisarlo) en vez de "Falta el token".
const MARGEN_MS = 24 * 60 * 60 * 1000;

const opciones = {
  httpOnly: true,
  // SameSite=None exige Secure: los navegadores rechazan la cookie si no lo tiene.
  secure: config.NODE_ENV === 'production' || config.COOKIE_SAMESITE === 'none',
  sameSite: config.COOKIE_SAMESITE,
  path: '/api',
};

export function guardarCookieSesion(res, accessToken) {
  const { exp } = jwt.decode(accessToken);
  res.cookie(COOKIE_SESION, accessToken, { ...opciones, expires: new Date(exp * 1000 + MARGEN_MS) });
}

export function borrarCookieSesion(res) {
  res.clearCookie(COOKIE_SESION, opciones);
}
