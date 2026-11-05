import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as catalogoService from '../services/catalogo.js';
import { paginationQuery } from '../utils/pagination.js';

// Lectura: cualquier usuario logueado. Escritura: solo admin.
export const catalogoRouter = Router();
// Auth solo sobre estos prefijos: el router está montado en "/" y un use() global
// respondería 401 a cualquier ruta inexistente en vez de 404.
catalogoRouter.use(['/generos', '/artistas', '/albumes', '/canciones'], requireAuth);
const soloAdmin = requireRole('admin');

const idParam = z.object({ id: z.coerce.number().int().positive() });
const texto = z.string().trim().min(1).max(200);
// La duración se manda en segundos y se guarda como interval
const duracionSeg = z.number().int().positive().max(86_399);
const algo = (b) => Object.keys(b).length > 0;

// ---------- Géneros ----------

catalogoRouter.get('/generos', async (_req, res) => {
  res.json(await catalogoService.listarGeneros());
});

catalogoRouter.post('/generos', soloAdmin, validate({ body: z.object({ nombre: texto }) }), async (req, res) => {
  res.status(201).json(await catalogoService.crearGenero(req.valid.body.nombre));
});

catalogoRouter.patch('/generos/:id', soloAdmin, validate({ params: idParam, body: z.object({ nombre: texto }) }), async (req, res) => {
  res.json(await catalogoService.actualizarGenero(req.valid.params.id, req.valid.body.nombre));
});

catalogoRouter.delete('/generos/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await catalogoService.borrarGenero(req.valid.params.id);
  res.status(204).end();
});

// Completa géneros con Last.fm
catalogoRouter.post(
  '/generos/sincronizar',
  validate({ body: z.object({ limite: z.number().int().min(1).max(100).default(25) }).default({ limite: 25 }) }),
  async (req, res) => {
    res.json(await catalogoService.sincronizarGeneros(req.user, req.valid.body.limite));
  },
);

// ---------- Artistas ----------

const listaArtistasQuery = paginationQuery.extend({
  q: z.string().trim().min(1).optional(),
  generoId: z.coerce.number().int().positive().optional(),
});

catalogoRouter.get('/artistas', validate({ query: listaArtistasQuery }), async (req, res) => {
  res.json(await catalogoService.listarArtistas(req.valid.query));
});

catalogoRouter.get('/artistas/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await catalogoService.obtenerArtista(req.valid.params.id));
});

catalogoRouter.post('/artistas', soloAdmin, validate({ body: z.object({ nombre: texto }) }), async (req, res) => {
  res.status(201).json(await catalogoService.crearArtista(req.valid.body.nombre));
});

catalogoRouter.patch('/artistas/:id', soloAdmin, validate({ params: idParam, body: z.object({ nombre: texto }) }), async (req, res) => {
  res.json(await catalogoService.actualizarArtista(req.valid.params.id, req.valid.body.nombre));
});

catalogoRouter.delete('/artistas/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await catalogoService.borrarArtista(req.valid.params.id);
  res.status(204).end();
});

catalogoRouter.put(
  '/artistas/:id/generos',
  soloAdmin,
  validate({ params: idParam, body: z.object({ generoIds: z.array(z.number().int().positive()).max(10) }) }),
  async (req, res) => {
    await catalogoService.reemplazarGeneros(req.valid.params.id, req.valid.body.generoIds);
    res.status(204).end();
  },
);

// ---------- Álbumes ----------

catalogoRouter.get('/albumes/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await catalogoService.obtenerAlbum(req.valid.params.id));
});

const albumSchema = z.object({
  nombre: texto,
  artistaId: z.number().int().positive(),
  fechaLanzamiento: z.iso.date().nullable().optional(),
});

catalogoRouter.post('/albumes', soloAdmin, validate({ body: albumSchema }), async (req, res) => {
  res.status(201).json(await catalogoService.crearAlbum(req.valid.body));
});

catalogoRouter.patch(
  '/albumes/:id',
  soloAdmin,
  validate({ params: idParam, body: albumSchema.omit({ artistaId: true }).partial().refine(algo, 'Mandá al menos un campo') }),
  async (req, res) => {
    res.json(await catalogoService.actualizarAlbum(req.valid.params.id, req.valid.body));
  },
);

catalogoRouter.delete('/albumes/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await catalogoService.borrarAlbum(req.valid.params.id);
  res.status(204).end();
});

// ---------- Canciones ----------

const listaCancionesQuery = paginationQuery.extend({
  q: z.string().trim().min(1).optional(),
  artistaId: z.coerce.number().int().positive().optional(),
});

catalogoRouter.get('/canciones', validate({ query: listaCancionesQuery }), async (req, res) => {
  res.json(await catalogoService.listarCanciones(req.valid.query));
});

catalogoRouter.get('/canciones/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await catalogoService.obtenerCancion(req.valid.params.id));
});

const cancionSchema = z.object({
  nombre: texto,
  artistaId: z.number().int().positive(),
  albumId: z.number().int().positive().nullable().optional(),
  duracionSegundos: duracionSeg.nullable().optional(),
});

catalogoRouter.post('/canciones', soloAdmin, validate({ body: cancionSchema }), async (req, res) => {
  res.status(201).json(await catalogoService.crearCancion(req.valid.body));
});

// Canción de la API externa -> canción del catálogo (cualquier usuario logueado).
// La portada se le muestra a todos los usuarios de esa canción: solo se acepta del CDN de Apple.
const resolverSchema = z.object({
  nombre: texto,
  artista: texto,
  album: texto.nullable().optional(),
  duracionSegundos: duracionSeg.nullable().optional(),
  itunesId: z.number().int().positive().nullable().optional(),
  portadaUrl: z.url({ protocol: /^https$/, hostname: /\.mzstatic\.com$/ }).nullable().optional(),
});

catalogoRouter.post('/canciones/resolver', validate({ body: resolverSchema }), async (req, res) => {
  res.json(await catalogoService.resolverCancion(req.valid.body));
});

catalogoRouter.patch(
  '/canciones/:id',
  soloAdmin,
  validate({ params: idParam, body: cancionSchema.partial().refine(algo, 'Mandá al menos un campo') }),
  async (req, res) => {
    res.json(await catalogoService.actualizarCancion(req.valid.params.id, req.valid.body));
  },
);

catalogoRouter.delete('/canciones/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await catalogoService.borrarCancion(req.valid.params.id);
  res.status(204).end();
});
