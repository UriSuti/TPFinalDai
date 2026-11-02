import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { sincronizarGeneros } from '../services/generos.js';
import { notFound } from '../utils/errors.js';
import { offset, paginated, paginationQuery } from '../utils/pagination.js';

// Catálogo: géneros, artistas, álbumes y canciones.
// Lectura: cualquier usuario logueado. Escritura: solo admin (el catálogo
// normalmente se arma solo con las importaciones).
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

// Escapa % y _ para que la búsqueda los tome literales en ILIKE
const patron = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function unoOFalla(sql, params, msg) {
  const { rows } = await query(sql, params);
  if (!rows[0]) throw notFound(msg);
  return rows[0];
}

// ---------- Géneros ----------

catalogoRouter.get('/generos', async (_req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.nombre, count(ag.artista_id) AS artistas
       FROM public.generos g LEFT JOIN public.artistas_generos ag ON ag.genero_id = g.id
      GROUP BY g.id ORDER BY artistas DESC, g.nombre`,
  );
  res.json(rows);
});

catalogoRouter.post('/generos', soloAdmin, validate({ body: z.object({ nombre: texto }) }), async (req, res) => {
  const { rows } = await query('INSERT INTO public.generos (nombre) VALUES ($1) RETURNING id, nombre', [req.valid.body.nombre]);
  res.status(201).json(rows[0]);
});

catalogoRouter.patch('/generos/:id', soloAdmin, validate({ params: idParam, body: z.object({ nombre: texto }) }), async (req, res) => {
  res.json(await unoOFalla(
    'UPDATE public.generos SET nombre = $2 WHERE id = $1 RETURNING id, nombre',
    [req.valid.params.id, req.valid.body.nombre], 'Género no encontrado',
  ));
});

catalogoRouter.delete('/generos/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await unoOFalla('DELETE FROM public.generos WHERE id = $1 RETURNING id', [req.valid.params.id], 'Género no encontrado');
  res.status(204).end();
});

// Completa géneros con Last.fm. Un usuario sincroniza los artistas que escuchó; admin, todos.
catalogoRouter.post(
  '/generos/sincronizar',
  validate({ body: z.object({ limite: z.number().int().min(1).max(100).default(25) }).default({ limite: 25 }) }),
  async (req, res) => {
    res.json(await sincronizarGeneros({
      limite: req.valid.body.limite,
      soloDelUsuario: req.user.rol === 'admin' ? undefined : req.user.id,
    }));
  },
);

// ---------- Artistas ----------

const listaArtistasQuery = paginationQuery.extend({
  q: z.string().trim().min(1).optional(),
  generoId: z.coerce.number().int().positive().optional(),
});

catalogoRouter.get('/artistas', validate({ query: listaArtistasQuery }), async (req, res) => {
  const p = req.valid.query;
  const where = `($1::text IS NULL OR a.nombre ILIKE $1)
    AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM public.artistas_generos ag WHERE ag.artista_id = a.id AND ag.genero_id = $2))`;
  const params = [p.q ? patron(p.q) : null, p.generoId ?? null];

  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(
      `SELECT a.id, a.nombre,
              COALESCE((SELECT json_agg(json_build_object('id', g.id, 'nombre', g.nombre) ORDER BY g.nombre)
                          FROM public.artistas_generos ag JOIN public.generos g ON g.id = ag.genero_id
                         WHERE ag.artista_id = a.id), '[]') AS generos
         FROM public.artistas a WHERE ${where}
        ORDER BY a.nombre LIMIT $3 OFFSET $4`,
      [...params, p.limit, offset(p)],
    ),
    query(`SELECT count(*) AS total FROM public.artistas a WHERE ${where}`, params),
  ]);
  res.json(paginated(rows, p, total));
});

catalogoRouter.get('/artistas/:id', validate({ params: idParam }), async (req, res) => {
  const artista = await unoOFalla(
    `SELECT a.id, a.nombre, a.generos_sincronizados_en,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'nombre', g.nombre) ORDER BY g.nombre)
                        FROM public.artistas_generos ag JOIN public.generos g ON g.id = ag.genero_id
                       WHERE ag.artista_id = a.id), '[]') AS generos,
            COALESCE((SELECT json_agg(json_build_object('id', p.id, 'nombre', p.nombre,
                                                        'fecha_lanzamiento', p.fecha_lanzamiento)
                                      ORDER BY p.fecha_lanzamiento NULLS LAST, p.nombre)
                        FROM public.playlists p WHERE p.es_album AND p.artista_id = a.id), '[]') AS albumes,
            (SELECT count(*) FROM public.canciones c WHERE c.artista_id = a.id) AS canciones
       FROM public.artistas a WHERE a.id = $1`,
    [req.valid.params.id], 'Artista no encontrado',
  );
  res.json(artista);
});

catalogoRouter.post('/artistas', soloAdmin, validate({ body: z.object({ nombre: texto }) }), async (req, res) => {
  const { rows } = await query('INSERT INTO public.artistas (nombre) VALUES ($1) RETURNING id, nombre', [req.valid.body.nombre]);
  res.status(201).json(rows[0]);
});

catalogoRouter.patch('/artistas/:id', soloAdmin, validate({ params: idParam, body: z.object({ nombre: texto }) }), async (req, res) => {
  res.json(await unoOFalla(
    'UPDATE public.artistas SET nombre = $2 WHERE id = $1 RETURNING id, nombre',
    [req.valid.params.id, req.valid.body.nombre], 'Artista no encontrado',
  ));
});

catalogoRouter.delete('/artistas/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await unoOFalla('DELETE FROM public.artistas WHERE id = $1 RETURNING id', [req.valid.params.id], 'Artista no encontrado');
  res.status(204).end();
});

// Reemplaza la lista completa de géneros del artista
catalogoRouter.put(
  '/artistas/:id/generos',
  soloAdmin,
  validate({ params: idParam, body: z.object({ generoIds: z.array(z.number().int().positive()).max(10) }) }),
  async (req, res) => {
    const { id } = req.valid.params;
    await withTransaction(async (client) => {
      const { rowCount } = await client.query('SELECT 1 FROM public.artistas WHERE id = $1 FOR UPDATE', [id]);
      if (!rowCount) throw notFound('Artista no encontrado');
      await client.query('DELETE FROM public.artistas_generos WHERE artista_id = $1', [id]);
      await client.query(
        `INSERT INTO public.artistas_generos (artista_id, genero_id)
         SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
        [id, req.valid.body.generoIds],
      );
      await client.query('UPDATE public.artistas SET generos_sincronizados_en = now() WHERE id = $1', [id]);
    });
    res.status(204).end();
  },
);

// ---------- Álbumes (playlists con es_album = true) ----------

catalogoRouter.get('/albumes/:id', validate({ params: idParam }), async (req, res) => {
  const album = await unoOFalla(
    `SELECT p.id, p.nombre, p.fecha_lanzamiento, d.duracion,
            json_build_object('id', a.id, 'nombre', a.nombre) AS artista,
            COALESCE((SELECT json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'duracion', EXTRACT(epoch FROM c.duracion)::int) ORDER BY c.id)
                        FROM public.canciones c WHERE c.album_id = p.id), '[]') AS canciones
       FROM public.playlists p
       JOIN public.artistas a ON a.id = p.artista_id
       JOIN public.playlists_duracion d ON d.id = p.id
      WHERE p.id = $1 AND p.es_album`,
    [req.valid.params.id], 'Álbum no encontrado',
  );
  res.json(album);
});

const albumSchema = z.object({
  nombre: texto,
  artistaId: z.number().int().positive(),
  fechaLanzamiento: z.iso.date().nullable().optional(),
});

catalogoRouter.post('/albumes', soloAdmin, validate({ body: albumSchema }), async (req, res) => {
  const b = req.valid.body;
  const { rows } = await query(
    `INSERT INTO public.playlists (nombre, es_album, artista_id, fecha_lanzamiento)
     VALUES ($1, true, $2, $3) RETURNING id, nombre, artista_id, fecha_lanzamiento`,
    [b.nombre, b.artistaId, b.fechaLanzamiento ?? null],
  );
  res.status(201).json(rows[0]);
});

catalogoRouter.patch(
  '/albumes/:id',
  soloAdmin,
  validate({ params: idParam, body: albumSchema.omit({ artistaId: true }).partial().refine(algo, 'Mandá al menos un campo') }),
  async (req, res) => {
    const b = req.valid.body;
    res.json(await unoOFalla(
      `UPDATE public.playlists
          SET nombre = COALESCE($2, nombre),
              fecha_lanzamiento = CASE WHEN $4 THEN $3::date ELSE fecha_lanzamiento END
        WHERE id = $1 AND es_album
        RETURNING id, nombre, artista_id, fecha_lanzamiento`,
      [req.valid.params.id, b.nombre ?? null, b.fechaLanzamiento ?? null, 'fechaLanzamiento' in b],
      'Álbum no encontrado',
    ));
  },
);

catalogoRouter.delete('/albumes/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await unoOFalla('DELETE FROM public.playlists WHERE id = $1 AND es_album RETURNING id', [req.valid.params.id], 'Álbum no encontrado');
  res.status(204).end();
});

// ---------- Canciones ----------

const listaCancionesQuery = paginationQuery.extend({
  q: z.string().trim().min(1).optional(),
  artistaId: z.coerce.number().int().positive().optional(),
});

const SELECT_CANCION = `
  SELECT c.id, c.nombre, c.duracion, c.spotify_uri,
         json_build_object('id', a.id, 'nombre', a.nombre) AS artista,
         CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'nombre', p.nombre) END AS album
    FROM public.canciones c
    JOIN public.artistas a ON a.id = c.artista_id
    LEFT JOIN public.playlists p ON p.id = c.album_id`;

catalogoRouter.get('/canciones', validate({ query: listaCancionesQuery }), async (req, res) => {
  const p = req.valid.query;
  const where = '($1::text IS NULL OR c.nombre ILIKE $1 OR a.nombre ILIKE $1) AND ($2::int IS NULL OR c.artista_id = $2)';
  const params = [p.q ? patron(p.q) : null, p.artistaId ?? null];

  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(`${SELECT_CANCION} WHERE ${where} ORDER BY a.nombre, c.nombre LIMIT $3 OFFSET $4`, [...params, p.limit, offset(p)]),
    query(`SELECT count(*) AS total FROM public.canciones c JOIN public.artistas a ON a.id = c.artista_id WHERE ${where}`, params),
  ]);
  res.json(paginated(rows, p, total));
});

catalogoRouter.get('/canciones/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await unoOFalla(`${SELECT_CANCION} WHERE c.id = $1`, [req.valid.params.id], 'Canción no encontrada'));
});

const cancionSchema = z.object({
  nombre: texto,
  artistaId: z.number().int().positive(),
  albumId: z.number().int().positive().nullable().optional(),
  duracionSegundos: duracionSeg.nullable().optional(),
});

catalogoRouter.post('/canciones', soloAdmin, validate({ body: cancionSchema }), async (req, res) => {
  const b = req.valid.body;
  const { rows } = await query(
    `INSERT INTO public.canciones (nombre, artista_id, album_id, duracion)
     VALUES ($1, $2, $3, make_interval(secs => $4)) RETURNING id`,
    [b.nombre, b.artistaId, b.albumId ?? null, b.duracionSegundos ?? null],
  );
  res.status(201).json(await unoOFalla(`${SELECT_CANCION} WHERE c.id = $1`, [rows[0].id]));
});

catalogoRouter.patch(
  '/canciones/:id',
  soloAdmin,
  validate({ params: idParam, body: cancionSchema.partial().refine(algo, 'Mandá al menos un campo') }),
  async (req, res) => {
    const b = req.valid.body;
    await unoOFalla(
      `UPDATE public.canciones
          SET nombre     = COALESCE($2, nombre),
              artista_id = COALESCE($3, artista_id),
              album_id   = CASE WHEN $6 THEN $4::int ELSE album_id END,
              duracion   = CASE WHEN $7 THEN make_interval(secs => $5) ELSE duracion END
        WHERE id = $1 RETURNING id`,
      [req.valid.params.id, b.nombre ?? null, b.artistaId ?? null, b.albumId ?? null,
        b.duracionSegundos ?? null, 'albumId' in b, 'duracionSegundos' in b],
      'Canción no encontrada',
    );
    res.json(await unoOFalla(`${SELECT_CANCION} WHERE c.id = $1`, [req.valid.params.id]));
  },
);

catalogoRouter.delete('/canciones/:id', soloAdmin, validate({ params: idParam }), async (req, res) => {
  await unoOFalla('DELETE FROM public.canciones WHERE id = $1 RETURNING id', [req.valid.params.id], 'Canción no encontrada');
  res.status(204).end();
});
