import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as puntuacionesService from '../services/puntuaciones.js';

export const puntuacionesRouter = Router();
puntuacionesRouter.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const tipoParam = z.object({ tipo: z.enum(['cancion', 'album']) });
const puntuarSchema = z.object({
  puntuacion: z.number().int().min(1).max(5),
  comentario: z.string().trim().max(500).nullable().optional(),
});

puntuacionesRouter.get('/puntuaciones', validate({ query: z.object({ tipo: z.enum(['cancion', 'album']).optional() }) }), async (req, res) => {
  res.json(await puntuacionesService.listarPuntuaciones(req.user.id, req.valid.query.tipo));
});

puntuacionesRouter.get('/puntuaciones/:tipo/:id', validate({ params: tipoParam.extend({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  res.json(await puntuacionesService.obtenerPuntuacion(req.user.id, req.valid.params.tipo, req.valid.params.id));
});

puntuacionesRouter.put('/puntuaciones/:tipo/:id', validate({ params: tipoParam.extend({ id: z.coerce.number().int().positive() }), body: puntuarSchema }), async (req, res) => {
  const data = await puntuacionesService.crearEditarPuntuacion(req.user.id, req.valid.params.tipo, req.valid.params.id, req.valid.body);
  res.status(201).json(data);
});

puntuacionesRouter.patch('/puntuaciones/:tipo/:id', validate({ params: tipoParam.extend({ id: z.coerce.number().int().positive() }), body: puntuarSchema.partial().refine((b) => Object.keys(b).length > 0, 'Mandá al menos un campo') }), async (req, res) => {
  const data = await puntuacionesService.crearEditarPuntuacion(req.user.id, req.valid.params.tipo, req.valid.params.id, req.valid.body);
  res.json(data);
});

puntuacionesRouter.delete('/puntuaciones/:tipo/:id', validate({ params: tipoParam.extend({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  await puntuacionesService.borrarPuntuacion(req.user.id, req.valid.params.tipo, req.valid.params.id);
  res.status(204).end();
});
