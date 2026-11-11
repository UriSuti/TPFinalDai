import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';
import * as authService from '../services/auth.js';
import { borrarCookieSesion, guardarCookieSesion } from '../utils/cookieSesion.js';

export const authRouter = Router();
export const meRouter = Router();

// bcrypt solo usa los primeros 72 bytes: más largo se rechaza para no truncar en silencio.
const password = z.string().min(8, 'Mínimo 8 caracteres')
  .refine((p) => Buffer.byteLength(p) <= 72, 'Máximo 72 bytes');
const texto = z.string().trim().min(1).max(100);

const registroSchema = z.object({
  nombre: texto,
  apellido: texto,
  email: z.email().max(254),
  password,
});

// Por defecto (navegador) el JWT va en una cookie HttpOnly y el body solo trae el usuario:
// JavaScript nunca ve un token. Clientes sin cookies (Postman, mobile): ?modo=tokens
// devuelve access + refresh en el body, para usarlos con "Authorization: Bearer".
const modoQuery = z.object({ modo: z.enum(['cookie', 'tokens']).default('cookie') });

function responderSesion(res, status, { usuario, ...sesion }, modo) {
  if (modo === 'tokens') return res.status(status).json({ usuario, ...sesion });
  guardarCookieSesion(res, sesion.accessToken);
  return res.status(status).json({ usuario });
}

authRouter.post('/register', authLimiter, validate({ body: registroSchema, query: modoQuery }), async (req, res) => {
  const { modo } = req.valid.query;
  responderSesion(res, 201, await authService.registrar(req.valid.body, modo), modo);
});

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().trim(), password: z.string() }), query: modoQuery }),
  async (req, res) => {
    const { modo } = req.valid.query;
    responderSesion(res, 200, await authService.login(req.valid.body.email, req.valid.body.password, modo), modo);
  },
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  res.json(await authService.refrescar(req.valid.body.refreshToken));
});

// El navegador no manda body: se le borra la cookie. Un cliente con tokens manda su refresh para revocarlo.
const logoutSchema = z.object({ refreshToken: z.string().min(1).optional() });

authRouter.post('/logout', validate({ body: logoutSchema }), async (req, res) => {
  if (req.valid.body.refreshToken) await authService.logout(req.valid.body.refreshToken);
  borrarCookieSesion(res);
  res.status(204).end();
});


// ---------- /me: perfil del usuario logueado ----------

meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  res.json(await authService.obtenerPerfil(req.user.id));
});

const perfilSchema = z.object({
  nombre: texto.optional(),
  apellido: texto.optional(),
  lastfm_usuario: z.string().trim().min(1).max(64).nullable().optional(),
  avatar_url: z.string().trim().min(1).max(500).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  generos_preferidos: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  artistas_preferidos: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
}).refine((b) => Object.keys(b).length > 0, 'Mandá al menos un campo');

meRouter.patch('/', validate({ body: perfilSchema }), async (req, res) => {
  res.json(await authService.actualizarPerfil(req.user.id, req.valid.body));
});

meRouter.put(
  '/password',
  validate({ body: z.object({ actual: z.string(), nueva: password }) }),
  async (req, res) => {
    await authService.cambiarPassword(req.user.id, req.valid.body.actual, req.valid.body.nueva);
    borrarCookieSesion(res);
    res.status(204).end();
  },
);

meRouter.delete('/', validate({ body: z.object({ password: z.string() }) }), async (req, res) => {
  await authService.borrarCuenta(req.user.id, req.valid.body.password);
  borrarCookieSesion(res);
  res.status(204).end();
});
