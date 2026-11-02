import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { notFound } from '../utils/errors.js';
import { offset, paginated, paginationQuery } from '../utils/pagination.js';

// Biblioteca del usuario logueado: playlists propias y favoritos.
// Siempre se filtra por req.user.id: nadie puede ver ni tocar lo de otro usuario.
// Si una playlist es de otro, se responde 404 (no 403) para no revelar que existe.
export const bibliotecaRouter = Router();
bibliotecaRouter.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const playlistCancionParams = idParam.extend({ cancionId: z.coerce.number().int().positive() });
const cancionParam = z.object({ cancionId: z.coerce.number().int().positive() });
const nombreBody = z.object({ nombre: z.string().trim().min(1).max(200) });

async function playlistPropia(id, usuarioId) {
  const { rows } = await query(
    'SELECT id FROM public.playlists WHERE id = $1 AND usuario_id = $2 AND NOT es_album',
    [id, usuarioId],
  );
  if (!rows[0]) throw notFound('Playlist no encontrada');
}

// ---------- Playlists ----------

bibliotecaRouter.get('/playlists', async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.fecha_creacion, d.duracion,
            (SELECT count(*) FROM public.canciones_playlists cp WHERE cp.playlist_id = p.id) AS canciones
       FROM public.playlists p JOIN public.playlists_duracion d ON d.id = p.id
      WHERE p.usuario_id = $1 AND NOT p.es_album
      ORDER BY p.fecha_creacion DESC`,
    [req.user.id],
  );
  res.json(rows);
});

bibliotecaRouter.post('/playlists', validate({ body: nombreBody }), async (req, res) => {
  const { rows } = await query(
    `INSERT INTO public.playlists (nombre, usuario_id) VALUES ($1, $2)
     RETURNING id, nombre, fecha_creacion`,
    [req.valid.body.nombre, req.user.id],
  );
  res.status(201).json(rows[0]);
});

bibliotecaRouter.get('/playlists/:id', validate({ params: idParam }), async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.fecha_creacion, d.duracion,
            COALESCE((SELECT json_agg(json_build_object(
                         'id', c.id, 'nombre', c.nombre, 'duracion', EXTRACT(epoch FROM c.duracion)::int,
                         'artista', a.nombre, 'fecha_agregada', cp.fecha_agregada)
                       ORDER BY cp.fecha_agregada)
                        FROM public.canciones_playlists cp
                        JOIN public.canciones c ON c.id = cp.cancion_id
                        JOIN public.artistas a ON a.id = c.artista_id
                       WHERE cp.playlist_id = p.id), '[]') AS canciones
       FROM public.playlists p JOIN public.playlists_duracion d ON d.id = p.id
      WHERE p.id = $1 AND p.usuario_id = $2 AND NOT p.es_album`,
    [req.valid.params.id, req.user.id],
  );
  if (!rows[0]) throw notFound('Playlist no encontrada');
  res.json(rows[0]);
});

bibliotecaRouter.patch('/playlists/:id', validate({ params: idParam, body: nombreBody }), async (req, res) => {
  const { rows } = await query(
    `UPDATE public.playlists SET nombre = $3
      WHERE id = $1 AND usuario_id = $2 AND NOT es_album
      RETURNING id, nombre, fecha_creacion`,
    [req.valid.params.id, req.user.id, req.valid.body.nombre],
  );
  if (!rows[0]) throw notFound('Playlist no encontrada');
  res.json(rows[0]);
});

bibliotecaRouter.delete('/playlists/:id', validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM public.playlists WHERE id = $1 AND usuario_id = $2 AND NOT es_album',
    [req.valid.params.id, req.user.id],
  );
  if (!rowCount) throw notFound('Playlist no encontrada');
  res.status(204).end();
});

bibliotecaRouter.post(
  '/playlists/:id/canciones',
  validate({ params: idParam, body: z.object({ cancionId: z.number().int().positive() }) }),
  async (req, res) => {
    await playlistPropia(req.valid.params.id, req.user.id);
    // Si la canción no existe, la FK tira 23503 y el errorHandler responde 400
    const { rowCount } = await query(
      `INSERT INTO public.canciones_playlists (playlist_id, cancion_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.valid.params.id, req.valid.body.cancionId],
    );
    res.status(rowCount ? 201 : 200).json({ agregada: rowCount === 1 });
  },
);

bibliotecaRouter.delete('/playlists/:id/canciones/:cancionId', validate({ params: playlistCancionParams }), async (req, res) => {
  await playlistPropia(req.valid.params.id, req.user.id);
  const { rowCount } = await query(
    'DELETE FROM public.canciones_playlists WHERE playlist_id = $1 AND cancion_id = $2',
    [req.valid.params.id, req.valid.params.cancionId],
  );
  if (!rowCount) throw notFound('La canción no está en la playlist');
  res.status(204).end();
});

// ---------- Favoritos ----------

bibliotecaRouter.get('/favoritos', validate({ query: paginationQuery }), async (req, res) => {
  const p = req.valid.query;
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(
      `SELECT c.id, c.nombre, c.duracion, a.id AS artista_id, a.nombre AS artista, f.fecha_agregada
         FROM public.favoritos f
         JOIN public.canciones c ON c.id = f.cancion_id
         JOIN public.artistas a ON a.id = c.artista_id
        WHERE f.usuario_id = $1
        ORDER BY f.fecha_agregada DESC LIMIT $2 OFFSET $3`,
      [req.user.id, p.limit, offset(p)],
    ),
    query('SELECT count(*) AS total FROM public.favoritos WHERE usuario_id = $1', [req.user.id]),
  ]);
  res.json(paginated(rows, p, total));
});

// PUT idempotente: marcar dos veces como favorito no falla
bibliotecaRouter.put('/favoritos/:cancionId', validate({ params: cancionParam }), async (req, res) => {
  const { rowCount } = await query(
    'INSERT INTO public.favoritos (usuario_id, cancion_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.user.id, req.valid.params.cancionId],
  );
  res.status(rowCount ? 201 : 200).json({ favorito: true });
});

bibliotecaRouter.delete('/favoritos/:cancionId', validate({ params: cancionParam }), async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM public.favoritos WHERE usuario_id = $1 AND cancion_id = $2',
    [req.user.id, req.valid.params.cancionId],
  );
  if (!rowCount) throw notFound('La canción no estaba en favoritos');
  res.status(204).end();
});
