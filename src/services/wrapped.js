import * as wrappedRepository from '../repositories/wrapped.js';
import { notFound } from '../utils/errors.js';

// Estadísticas tipo Wrapped: los números salen de las vistas SQL y acá se arman
// las respuestas (rellenar días y meses sin datos, favoritos, franjas).

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Franjas para la tarjeta "tu momento del día"
const franja = (h) => (h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche');

export async function habitos(usuarioId, anio) {
  const rows = await wrappedRepository.habitos(usuarioId, anio);
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

export async function porMes(usuarioId, anio) {
  const rows = await wrappedRepository.porMes(usuarioId, anio);
  return Array.from({ length: 12 }, (_, i) => rows.find((r) => r.mes === i + 1) ?? { mes: i + 1, minutos: 0, streams: 0 });
}

// Años con datos (para el selector del front)
export const listarAnios = (usuarioId) => wrappedRepository.listarResumenes(usuarioId);

export const topCanciones = (usuarioId, anio, limit) => wrappedRepository.topCanciones(usuarioId, anio, limit);
export const topArtistas = (usuarioId, anio, limit) => wrappedRepository.topArtistas(usuarioId, anio, limit);
export const topGeneros = (usuarioId, anio, limit) => wrappedRepository.topGeneros(usuarioId, anio, limit);

// Wrapped completo de un año: todo lo que necesita la pantalla principal en una request
export async function obtenerWrapped(usuarioId, anio) {
  const resumen = await wrappedRepository.obtenerResumen(usuarioId, anio);
  if (!resumen) throw notFound(`No hay reproducciones en ${anio}`);

  const [canciones, artistas, generos, habitosAnio, meses, minutosEstimados] = await Promise.all([
    topCanciones(usuarioId, anio, 5),
    topArtistas(usuarioId, anio, 5),
    topGeneros(usuarioId, anio, 5),
    habitos(usuarioId, anio),
    porMes(usuarioId, anio),
    wrappedRepository.hayMinutosEstimados(usuarioId, anio),
  ]);
  const { heatmap: _h, porHora: _p, ...habitosResumen } = habitosAnio;

  return {
    anio,
    resumen,
    topCanciones: canciones,
    topArtistas: artistas,
    topGeneros: generos,
    habitos: habitosResumen,
    porMes: meses,
    // Si hay reproducciones sin ms (Last.fm), los minutos son estimados
    minutosEstimados,
  };
}
