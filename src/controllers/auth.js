import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';
import * as authService from '../services/auth.js';

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

authRouter.post('/register', authLimiter, validate({ body: registroSchema }), async (req, res) => {
  res.status(201).json(await authService.registrar(req.valid.body));
});

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().trim(), password: z.string() }) }),
  async (req, res) => {
    res.json(await authService.login(req.valid.body.email, req.valid.body.password));
  },
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  res.json(await authService.refrescar(req.valid.body.refreshToken));
});

authRouter.post('/logout', validate({ body: refreshSchema }), async (req, res) => {
  await authService.logout(req.valid.body.refreshToken);
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
}).refine((b) => Object.keys(b).length > 0, 'Mandá al menos un campo');

meRouter.patch('/', validate({ body: perfilSchema }), async (req, res) => {
  res.json(await authService.actualizarPerfil(req.user.id, req.valid.body));
});

meRouter.put(
  '/password',
  validate({ body: z.object({ actual: z.string(), nueva: password }) }),
  async (req, res) => {
    await authService.cambiarPassword(req.user.id, req.valid.body.actual, req.valid.body.nueva);
    res.status(204).end();
  },
);

meRouter.delete('/', validate({ body: z.object({ password: z.string() }) }), async (req, res) => {
  await authService.borrarCuenta(req.user.id, req.valid.body.password);
  res.status(204).end();
});
