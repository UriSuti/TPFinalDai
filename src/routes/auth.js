import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';
import { emitirSesion, revocarRefreshToken, rotarRefreshToken } from '../services/tokens.js';
import { conflict, notFound, unauthorized } from '../utils/errors.js';

export const authRouter = Router();
export const meRouter = Router();

const COLUMNAS = 'id, nombre, apellido, email, rol, lastfm_usuario, fecha_registro';

// bcrypt solo usa los primeros 72 bytes: más largo se rechaza para no truncar en silencio.
const password = z.string().min(8, 'Mínimo 8 caracteres')
  .refine((p) => Buffer.byteLength(p) <= 72, 'Máximo 72 bytes');
const texto = z.string().trim().min(1).max(100);

// Hash de una contraseña cualquiera: si el email no existe igual se compara contra algo,
// así el tiempo de respuesta no revela qué emails están registrados.
const HASH_FALSO = bcrypt.hashSync('contraseña-que-no-existe', config.BCRYPT_ROUNDS);

const registroSchema = z.object({
  nombre: texto,
  apellido: texto,
  email: z.email().max(254),
  password,
});

authRouter.post('/register', authLimiter, validate({ body: registroSchema }), async (req, res) => {
  const { nombre, apellido, email, password: pass } = req.valid.body;
  const passwordHash = await bcrypt.hash(pass, config.BCRYPT_ROUNDS);

  const resultado = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO public.usuarios (nombre, apellido, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO NOTHING
       RETURNING ${COLUMNAS}`,
      [nombre, apellido, email, passwordHash],
    );
    if (!rows[0]) throw conflict('Ya existe una cuenta con ese email');
    return { usuario: rows[0], ...(await emitirSesion(rows[0], client)) };
  });

  res.status(201).json(resultado);
});

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().trim(), password: z.string() }) }),
  async (req, res) => {
    const { email, password: pass } = req.valid.body;
    const { rows } = await query(
      `SELECT ${COLUMNAS}, password_hash FROM public.usuarios WHERE lower(email) = lower($1)`,
      [email],
    );
    const usuario = rows[0];
    const ok = await bcrypt.compare(pass, usuario?.password_hash ?? HASH_FALSO);
    if (!usuario || !ok) throw unauthorized('Email o contraseña incorrectos');

    delete usuario.password_hash;
    res.json({ usuario, ...(await emitirSesion(usuario)) });
  },
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  const resultado = await rotarRefreshToken(req.valid.body.refreshToken);
  if (resultado.reuso) throw unauthorized('Refresh token reutilizado: se cerraron todas tus sesiones');
  res.json(resultado.sesion);
});

authRouter.post('/logout', validate({ body: refreshSchema }), async (req, res) => {
  await revocarRefreshToken(req.valid.body.refreshToken);
  res.status(204).end();
});


// ---------- /me: perfil del usuario logueado ----------

meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM public.usuarios WHERE id = $1`, [req.user.id]);
  if (!rows[0]) throw notFound('Usuario no encontrado');
  res.json(rows[0]);
});

const perfilSchema = z.object({
  nombre: texto.optional(),
  apellido: texto.optional(),
  lastfm_usuario: z.string().trim().min(1).max(64).nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, 'Mandá al menos un campo');

meRouter.patch('/', validate({ body: perfilSchema }), async (req, res) => {
  const campos = Object.entries(req.valid.body);
  const set = campos.map(([k], i) => `${k} = $${i + 2}`).join(', '); // claves fijas del schema zod
  const { rows } = await query(
    `UPDATE public.usuarios SET ${set} WHERE id = $1 RETURNING ${COLUMNAS}`,
    [req.user.id, ...campos.map(([, v]) => v)],
  );
  res.json(rows[0]);
});

meRouter.put(
  '/password',
  validate({ body: z.object({ actual: z.string(), nueva: password }) }),
  async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM public.usuarios WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(req.valid.body.actual, rows[0].password_hash))) {
      throw unauthorized('La contraseña actual no es correcta');
    }
    const nuevoHash = await bcrypt.hash(req.valid.body.nueva, config.BCRYPT_ROUNDS);
    await withTransaction(async (client) => {
      await client.query('UPDATE public.usuarios SET password_hash = $2 WHERE id = $1', [req.user.id, nuevoHash]);
      // Cambiar la contraseña cierra todas las sesiones abiertas
      await client.query(
        'UPDATE public.refresh_tokens SET revocado_en = now() WHERE usuario_id = $1 AND revocado_en IS NULL',
        [req.user.id],
      );
    });
    res.status(204).end();
  },
);

meRouter.delete('/', validate({ body: z.object({ password: z.string() }) }), async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM public.usuarios WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(req.valid.body.password, rows[0].password_hash))) {
    throw unauthorized('Contraseña incorrecta');
  }
  // CASCADE: se borran playlists, favoritos, reproducciones, importaciones y tokens
  await query('DELETE FROM public.usuarios WHERE id = $1', [req.user.id]);
  res.status(204).end();
});
