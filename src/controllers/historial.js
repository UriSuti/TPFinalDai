import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { uploadJson } from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import * as historialService from '../services/historial.js';
import { badRequest } from '../utils/errors.js';
import { paginationQuery } from '../utils/pagination.js';

export const historialRouter = Router();
historialRouter.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- Reproducciones ----------

const listaQuery = paginationQuery.extend({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

historialRouter.get('/reproducciones', validate({ query: listaQuery }), async (req, res) => {
  res.json(await historialService.listarReproducciones(req.user.id, req.valid.query));
});

// Carga manual de una reproducción (para probar sin export, o para el reproductor del front)
const reproduccionSchema = z.object({
  cancionId: z.number().int().positive(),
  fechaHora: z.iso.datetime({ offset: true }).optional(),
  msReproducidos: z.number().int().min(0).max(86_400_000).optional(),
});

historialRouter.post('/reproducciones', validate({ body: reproduccionSchema }), async (req, res) => {
  res.status(201).json(await historialService.crearReproduccion(req.user.id, req.valid.body));
});

historialRouter.delete('/reproducciones/:id', validate({ params: idParam }), async (req, res) => {
  await historialService.borrarReproduccion(req.valid.params.id, req.user.id);
  res.status(204).end();
});

// ---------- Importaciones ----------

historialRouter.get('/importaciones', async (req, res) => {
  res.json(await historialService.listarImportaciones(req.user.id));
});

// multipart/form-data con uno o más archivos en el campo "archivos".
historialRouter.post('/importaciones/spotify', uploadJson, async (req, res) => {
  if (!req.files?.length) throw badRequest('Subí al menos un archivo .json en el campo "archivos"');

  const archivos = req.files.map((f) => ({ nombre: f.originalname, contenido: f.buffer }));
  res.status(201).json(await historialService.importarSpotify(req.user.id, archivos));
});

const lastfmSchema = z.object({
  usuario: z.string().trim().min(1).max(64).optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

historialRouter.post('/importaciones/lastfm', validate({ body: lastfmSchema }), async (req, res) => {
  res.status(201).json(await historialService.importarLastfm(req.user.id, req.valid.body));
});

historialRouter.delete('/importaciones/:id', validate({ params: idParam }), async (req, res) => {
  await historialService.borrarImportacion(req.valid.params.id, req.user.id);
  res.status(204).end();
});
