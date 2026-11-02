import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { uploadJson } from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import { importarEventos } from '../services/importador.js';
import { obtenerScrobbles } from '../services/lastfm.js';
import { parsearArchivoSpotify } from '../services/spotifyParser.js';
import { badRequest, notFound } from '../utils/errors.js';
import { offset, paginated, paginationQuery } from '../utils/pagination.js';

// Historial de escucha del usuario logueado: reproducciones e importaciones.
export const historialRouter = Router();
historialRouter.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- Reproducciones ----------

const listaQuery = paginationQuery.extend({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

historialRouter.get('/reproducciones', validate({ query: listaQuery }), async (req, res) => {
  const p = req.valid.query;
  const where = `r.usuario_id = $1 AND ($2::timestamptz IS NULL OR r.fecha_hora >= $2)
                 AND ($3::timestamptz IS NULL OR r.fecha_hora < $3)`;
  const params = [req.user.id, p.desde ?? null, p.hasta ?? null];

  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(
      `SELECT r.id, r.fecha_hora, r.ms_reproducidos, r.fuente, r.plataforma, r.aleatorio, r.salteada,
              c.id AS cancion_id, c.nombre AS cancion, a.id AS artista_id, a.nombre AS artista
         FROM public.reproducciones r
         JOIN public.canciones c ON c.id = r.cancion_id
         JOIN public.artistas a ON a.id = c.artista_id
        WHERE ${where}
        ORDER BY r.fecha_hora DESC LIMIT $4 OFFSET $5`,
      [...params, p.limit, offset(p)],
    ),
    query(`SELECT count(*) AS total FROM public.reproducciones r WHERE ${where}`, params),
  ]);
  res.json(paginated(rows, p, total));
});

// Carga manual de una reproducción (para probar sin export, o para el reproductor del front)
const reproduccionSchema = z.object({
  cancionId: z.number().int().positive(),
  fechaHora: z.iso.datetime({ offset: true }).optional(),
  msReproducidos: z.number().int().min(0).max(86_400_000).optional(),
});

historialRouter.post('/reproducciones', validate({ body: reproduccionSchema }), async (req, res) => {
  const b = req.valid.body;
  const { rows } = await query(
    `INSERT INTO public.reproducciones (usuario_id, cancion_id, fuente, fecha_hora, ms_reproducidos)
     VALUES ($1, $2, 'manual', COALESCE($3::timestamptz, now()), $4)
     RETURNING id, cancion_id, fuente, fecha_hora, ms_reproducidos`,
    [req.user.id, b.cancionId, b.fechaHora ?? null, b.msReproducidos ?? null],
  );
  res.status(201).json(rows[0]);
});

historialRouter.delete('/reproducciones/:id', validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM public.reproducciones WHERE id = $1 AND usuario_id = $2',
    [req.valid.params.id, req.user.id],
  );
  if (!rowCount) throw notFound('Reproducción no encontrada');
  res.status(204).end();
});

// ---------- Importaciones ----------

historialRouter.get('/importaciones', async (req, res) => {
  const { rows } = await query(
    `SELECT id, fuente, detalle, fecha, filas_leidas, filas_insertadas, filas_descartadas
       FROM public.importaciones WHERE usuario_id = $1 ORDER BY fecha DESC`,
    [req.user.id],
  );
  res.json(rows);
});

// multipart/form-data con uno o más archivos en el campo "archivos".
// Cada archivo genera su propia importación (se puede deshacer por separado).
historialRouter.post('/importaciones/spotify', uploadJson, async (req, res) => {
  if (!req.files?.length) throw badRequest('Subí al menos un archivo .json en el campo "archivos"');

  // Primero se parsean todos: si uno está mal, no se importa ninguno
  const parseados = req.files.map((f) => ({ archivo: f.originalname, ...parsearArchivoSpotify(f.buffer, f.originalname) }));
  if (parseados.every((p) => p.eventos.length === 0)) {
    throw badRequest('Los archivos no tienen reproducciones de música (¿son del export de Spotify?)');
  }

  const importaciones = [];
  for (const p of parseados) {
    importaciones.push(await importarEventos({
      usuarioId: req.user.id,
      fuente: 'spotify',
      detalle: p.archivo,
      eventos: p.eventos,
      leidas: p.leidas,
      descartadas: p.descartadas,
    }));
  }
  res.status(201).json(importaciones);
});

// Sincroniza scrobbles de Last.fm. Sin "desde", sigue desde el último scrobble importado.
const lastfmSchema = z.object({
  usuario: z.string().trim().min(1).max(64).optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
});

historialRouter.post('/importaciones/lastfm', validate({ body: lastfmSchema }), async (req, res) => {
  const b = req.valid.body;
  const { rows: [u] } = await query('SELECT lastfm_usuario FROM public.usuarios WHERE id = $1', [req.user.id]);
  const usuarioLastfm = b.usuario ?? u?.lastfm_usuario;
  if (!usuarioLastfm) throw badRequest('Indicá tu usuario de Last.fm (campo "usuario") o guardalo en tu perfil');

  let desde = b.desde ? new Date(b.desde) : null;
  if (!desde) {
    const { rows: [ultima] } = await query(
      `SELECT max(fecha_hora) AS fecha FROM public.reproducciones WHERE usuario_id = $1 AND fuente = 'lastfm'`,
      [req.user.id],
    );
    if (ultima.fecha) desde = new Date(ultima.fecha.getTime() + 1000);
  }

  const { eventos, completo } = await obtenerScrobbles(usuarioLastfm, {
    desde,
    hasta: b.hasta ? new Date(b.hasta) : null,
  });
  const validos = eventos.filter((e) => e.artista && e.cancion);

  // Si funcionó, se guarda el usuario en el perfil para la próxima
  await query('UPDATE public.usuarios SET lastfm_usuario = $2 WHERE id = $1', [req.user.id, usuarioLastfm]);

  const importacion = await importarEventos({
    usuarioId: req.user.id,
    fuente: 'lastfm',
    detalle: `last.fm/user/${usuarioLastfm}`,
    eventos: validos,
    leidas: eventos.length,
    descartadas: eventos.length - validos.length,
  });
  // completo = false: había más de 10.000 scrobbles; volver a llamar trae el resto
  res.status(201).json({ ...importacion, completo });
});

// Deshacer: borra la importación y, por CASCADE, todas sus reproducciones
historialRouter.delete('/importaciones/:id', validate({ params: idParam }), async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM public.importaciones WHERE id = $1 AND usuario_id = $2',
    [req.valid.params.id, req.user.id],
  );
  if (!rowCount) throw notFound('Importación no encontrada');
  res.status(204).end();
});
