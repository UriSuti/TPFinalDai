import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as bibliotecaService from '../services/biblioteca.js';
import { paginationQuery } from '../utils/pagination.js';

// Siempre se usa req.user.id: el usuario sale del token, nunca del cliente.
export const bibliotecaRouter = Router();
bibliotecaRouter.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const playlistCancionParams = idParam.extend({ cancionId: z.coerce.number().int().positive() });
const cancionParam = z.object({ cancionId: z.coerce.number().int().positive() });
const nombreBody = z.object({ nombre: z.string().trim().min(1).max(200) });

// ---------- Playlists ----------

bibliotecaRouter.get('/playlists', async (req, res) => {
  res.json(await bibliotecaService.listarPlaylists(req.user.id));
});

bibliotecaRouter.post('/playlists', validate({ body: nombreBody }), async (req, res) => {
  res.status(201).json(await bibliotecaService.crearPlaylist(req.user.id, req.valid.body.nombre));
});

bibliotecaRouter.get('/playlists/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await bibliotecaService.obtenerPlaylist(req.valid.params.id, req.user.id));
});

bibliotecaRouter.patch('/playlists/:id', validate({ params: idParam, body: nombreBody }), async (req, res) => {
  res.json(await bibliotecaService.renombrarPlaylist(req.valid.params.id, req.user.id, req.valid.body.nombre));
});

bibliotecaRouter.delete('/playlists/:id', validate({ params: idParam }), async (req, res) => {
  await bibliotecaService.borrarPlaylist(req.valid.params.id, req.user.id);
  res.status(204).end();
});

bibliotecaRouter.post(
  '/playlists/:id/canciones',
  validate({ params: idParam, body: z.object({ cancionId: z.number().int().positive() }) }),
  async (req, res) => {
    const agregada = await bibliotecaService.agregarCancion(req.valid.params.id, req.user.id, req.valid.body.cancionId);
    res.status(agregada ? 201 : 200).json({ agregada });
  },
);

bibliotecaRouter.delete('/playlists/:id/canciones/:cancionId', validate({ params: playlistCancionParams }), async (req, res) => {
  await bibliotecaService.quitarCancion(req.valid.params.id, req.user.id, req.valid.params.cancionId);
  res.status(204).end();
});

// ---------- Favoritos ----------

bibliotecaRouter.get('/favoritos', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await bibliotecaService.listarFavoritos(req.user.id, req.valid.query));
});

// PUT idempotente: marcar dos veces como favorito no falla
bibliotecaRouter.put('/favoritos/:cancionId', validate({ params: cancionParam }), async (req, res) => {
  const nuevo = await bibliotecaService.agregarFavorito(req.user.id, req.valid.params.cancionId);
  res.status(nuevo ? 201 : 200).json({ favorito: true });
});

bibliotecaRouter.delete('/favoritos/:cancionId', validate({ params: cancionParam }), async (req, res) => {
  await bibliotecaService.quitarFavorito(req.user.id, req.valid.params.cancionId);
  res.status(204).end();
});
