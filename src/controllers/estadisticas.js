import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import * as estadisticasService from '../services/estadisticas.js';

export const estadisticasRouter = Router();
estadisticasRouter.use(requireAuth);

estadisticasRouter.get('/estadisticas', async (req, res) => {
  res.json(await estadisticasService.obtenerEstadisticas(req.user.id));
});
