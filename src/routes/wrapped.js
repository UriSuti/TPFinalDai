import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { notFound } from '../utils/errors.js';

// Estadísticas tipo Wrapped. Toda la lógica está en las vistas wrapped_* del esquema:
// acá solo se filtra por usuario (siempre el del token) y año.
export const wrappedRouter = Router();
wrappedRouter.use(requireAuth);

const anioParam = z.object({ anio: z.coerce.number().int().min(2000).max(2100) });
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Franjas para la tarjeta "tu momento del día"
const franja = (h) => (h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche');

const top = (vista, usuarioId, anio, limit) => query(
  `SELECT * FROM public.${vista} WHERE usuario_id = $1 AND anio = $2 AND puesto <= $3 ORDER BY puesto LIMIT $3`,
  [usuarioId, anio, limit],
).then((r) => r.rows.map(({ usuario_id, anio: _a, ...resto }) => resto));

async function habitos(usuarioId, anio) {
  const { rows } = await query(
    'SELECT dia_semana, hora, streams, minutos, salteadas FROM public.wrapped_habitos WHERE usuario_id = $1 AND anio = $2',
    [usuarioId, anio],
  );
  const porDia = DIAS.map((dia) => ({ dia, minutos: 0, streams: 0 }));
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, minutos: 0, streams: 0 }));
  const porFranja = { madrugada: 0, mañana: 0, tarde: 0, noche: 0 };
  let salteadas = 0;

  for (const r of rows) {
    porDia[r.dia_semana - 1].minutos += r.minutos;
    porDia[r.dia_semana - 1].streams += r.streams;
    porHora[r.hora].minutos += r.minutos;
    porHora[r.hora].streams += r.streams;
    porFranja[franja(r.hora)] += r.minutos;
    salteadas += r.salteadas;
  }
  const max = (arr, k) => arr.reduce((a, b) => (b[k] > a[k] ? b : a));
  return {
    diaFavorito: rows.length ? max(porDia, 'minutos').dia : null,
    horaFavorita: rows.length ? max(porHora, 'minutos').hora : null,
    franjaFavorita: rows.length ? Object.entries(porFranja).sort((a, b) => b[1] - a[1])[0][0] : null,
    salteadas,
    porDia,
    porHora,
    heatmap: rows, // dia_semana x hora, para un mapa de calor en el front
  };
}

async function porMes(usuarioId, anio) {
  const { rows } = await query(
    `SELECT EXTRACT(month FROM fecha_hora_local)::int AS mes,
            round(sum(ms_efectivos) / 60000.0)::int AS minutos,
            count(*) FILTER (WHERE es_stream) AS streams
       FROM public.reproducciones_local
      WHERE usuario_id = $1 AND anio = $2
      GROUP BY 1`,
    [usuarioId, anio],
  );
  return Array.from({ length: 12 }, (_, i) => rows.find((r) => r.mes === i + 1) ?? { mes: i + 1, minutos: 0, streams: 0 });
}

// Años con datos (para el selector del front)
wrappedRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT anio, minutos_escuchados, streams, canciones_distintas, artistas_distintos
       FROM public.wrapped_resumen WHERE usuario_id = $1 ORDER BY anio DESC`,
    [req.user.id],
  );
  res.json(rows);
});

// Wrapped completo de un año: todo lo que necesita la pantalla principal en una request
wrappedRouter.get('/:anio', validate({ params: anioParam }), async (req, res) => {
  const { anio } = req.valid.params;
  const uid = req.user.id;

  const { rows: [resumen] } = await query(
    `SELECT minutos_escuchados, streams, canciones_distintas, artistas_distintos
       FROM public.wrapped_resumen WHERE usuario_id = $1 AND anio = $2`,
    [uid, anio],
  );
  if (!resumen) throw notFound(`No hay reproducciones en ${anio}`);

  const [topCanciones, topArtistas, topGeneros, habitosAnio, meses, estimado] = await Promise.all([
    top('wrapped_top_canciones', uid, anio, 5),
    top('wrapped_top_artistas', uid, anio, 5),
    top('wrapped_top_generos', uid, anio, 5),
    habitos(uid, anio),
    porMes(uid, anio),
    query(
      `SELECT COALESCE(bool_or(ms_reproducidos IS NULL), false) AS hay
         FROM public.reproducciones
        WHERE usuario_id = $1
          AND EXTRACT(year FROM fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires') = $2`,
      [uid, anio],
    ),
  ]);
  const { heatmap: _h, porHora: _p, ...habitosResumen } = habitosAnio;

  res.json({
    anio,
    resumen,
    topCanciones,
    topArtistas,
    topGeneros,
    habitos: habitosResumen,
    porMes: meses,
    // Last.fm no informa cuánto se escuchó: si hay reproducciones sin ms, los minutos son estimados
    minutosEstimados: estimado.rows[0].hay,
  });
});

wrappedRouter.get('/:anio/canciones', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await top('wrapped_top_canciones', req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/artistas', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await top('wrapped_top_artistas', req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/generos', validate({ params: anioParam, query: limitQuery }), async (req, res) => {
  res.json(await top('wrapped_top_generos', req.user.id, req.valid.params.anio, req.valid.query.limit));
});

wrappedRouter.get('/:anio/habitos', validate({ params: anioParam }), async (req, res) => {
  res.json(await habitos(req.user.id, req.valid.params.anio));
});

wrappedRouter.get('/:anio/meses', validate({ params: anioParam }), async (req, res) => {
  res.json(await porMes(req.user.id, req.valid.params.anio));
});
