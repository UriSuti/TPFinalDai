import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as actividadService from '../services/actividad.js';
import { paginationQuery } from '../utils/pagination.js';

export const actividadRouter = Router();
actividadRouter.use(requireAuth);

const tipoQuery = z.enum(['biblioteca', 'favorito', 'resena', 'playlist', 'importacion']).optional();

actividadRouter.get('/actividad', validate({ query: paginationQuery.extend({ tipo: tipoQuery }) }), async (req, res) => {
  res.json(await actividadService.listarActividad(req.user.id, req.valid.query));
});
