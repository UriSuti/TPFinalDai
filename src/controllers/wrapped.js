import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as wrappedService from '../services/wrapped.js';

// Siempre se consulta el usuario del token, nunca uno que mande el cliente.
export const wrappedRouter = Router();
wrappedRouter.use(requireAuth);

const anioParam = z.object({ anio: z.coerce.number().int().min(2000).max(2100) });
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

wrappedRouter.get('/', async (req, res) => {
  res.json(await wrappedService.listarAnios(req.user.id));
});

wrappedRouter.get('/:anio', validate({ params: anioParam }), async (req, res) => {
  res.json(await wrappedService.obtenerWrapped(req.user.id, req.valid.params.anio));
});

wrappedRouter.get('/:anio/canciones', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await wrappedService.topCanciones(req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/artistas', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await wrappedService.topArtistas(req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/generos', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await wrappedService.topGeneros(req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/habitos', validate({ params: anioParam }), async (req, res) => {
  res.json(await wrappedService.habitos(req.user.id, req.valid.params.anio));
});

wrappedRouter.get('/:anio/meses', validate({ params: anioParam }), async (req, res) => {
  res.json(await wrappedService.porMes(req.user.id, req.valid.params.anio));
});
