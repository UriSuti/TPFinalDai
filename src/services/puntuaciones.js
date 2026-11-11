import { withTransaction } from '../db.js';
import * as puntuacionesRepository from '../repositories/puntuaciones.js';
import { badRequest, notFound } from '../utils/errors.js';

const TIPOS_VALIDOS = new Set(['cancion', 'album']);

function validarTipo(tipo) {
  if (!TIPOS_VALIDOS.has(tipo)) throw badRequest('Tipo de puntuación no válido');
}

export async function listarPuntuaciones(usuarioId, tipo) {
  if (tipo && !TIPOS_VALIDOS.has(tipo)) throw badRequest('Tipo de puntuación no válido');
  return puntuacionesRepository.listarPorUsuario(usuarioId, tipo ?? null);
}

export async function obtenerPuntuacion(usuarioId, tipo, itemId) {
  validarTipo(tipo);
  const row = await puntuacionesRepository.obtener(usuarioId, tipo, itemId);
  if (!row) throw notFound('Puntuación no encontrada');
  return row;
}

export async function crearEditarPuntuacion(usuarioId, tipo, itemId, datos) {
  validarTipo(tipo);
  const { puntuacion, comentario } = datos;

  if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
    throw badRequest('La puntuación debe estar entre 1 y 5');
  }

  if (comentario !== undefined && comentario !== null && comentario.trim().length > 500) {
    throw badRequest('El comentario debe tener máximo 500 caracteres');
  }

  return withTransaction(async (client) => {
    const creada = await puntuacionesRepository.crearOActualizar({
      usuarioId,
      tipo,
      itemId,
      puntuacion,
      comentario: comentario ?? null,
    }, client);
    return creada;
  });
}

export async function borrarPuntuacion(usuarioId, tipo, itemId) {
  validarTipo(tipo);
  const borrada = await puntuacionesRepository.borrar(usuarioId, tipo, itemId);
  if (!borrada) throw notFound('Puntuación no encontrada');
  return borrada;
}
