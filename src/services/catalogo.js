import { withTransaction } from '../db.js';
import * as catalogoRepository from '../repositories/catalogo.js';
import { notFound } from '../utils/errors.js';
import { offset, paginated } from '../utils/pagination.js';
import { sincronizarGeneros as sincronizar } from './generos.js';

// Catálogo: géneros, artistas, álbumes y canciones. Normalmente se arma solo con las
// importaciones; quién puede escribirlo a mano (admin) lo decide el controller.

function oFalla(fila, msg) {
  if (!fila) throw notFound(msg);
  return fila;
}

// ---------- Géneros ----------

export const listarGeneros = () => catalogoRepository.listarGeneros();

export const crearGenero = (nombre) => catalogoRepository.crearGenero(nombre);

export async function actualizarGenero(id, nombre) {
  return oFalla(await catalogoRepository.actualizarGenero(id, nombre), 'Género no encontrado');
}

export async function borrarGenero(id) {
  oFalla(await catalogoRepository.borrarGenero(id), 'Género no encontrado');
}

// Un usuario sincroniza los artistas que escuchó; admin, todos.
export function sincronizarGeneros(usuario, limite) {
  return sincronizar({ limite, soloDelUsuario: usuario.rol === 'admin' ? undefined : usuario.id });
}

// ---------- Artistas ----------

export async function listarArtistas(p) {
  const [rows, total] = await Promise.all([
    catalogoRepository.listarArtistas({ ...p, offset: offset(p) }),
    catalogoRepository.contarArtistas(p),
  ]);
  return paginated(rows, p, total);
}

export async function obtenerArtista(id) {
  return oFalla(await catalogoRepository.obtenerArtista(id), 'Artista no encontrado');
}

export const crearArtista = (nombre) => catalogoRepository.crearArtista(nombre);

export async function actualizarArtista(id, nombre) {
  return oFalla(await catalogoRepository.actualizarArtista(id, nombre), 'Artista no encontrado');
}

export async function borrarArtista(id) {
  oFalla(await catalogoRepository.borrarArtista(id), 'Artista no encontrado');
}

// Reemplaza la lista completa de géneros del artista
export async function reemplazarGeneros(id, generoIds) {
  await withTransaction(async (client) => {
    if (!(await catalogoRepository.bloquearArtista(id, client))) throw notFound('Artista no encontrado');
    await catalogoRepository.reemplazarGeneros(id, generoIds, client);
    await catalogoRepository.marcarGenerosSincronizados(id, client);
  });
}

// ---------- Álbumes (playlists con es_album = true) ----------

export async function obtenerAlbum(id) {
  return oFalla(await catalogoRepository.obtenerAlbum(id), 'Álbum no encontrado');
}

export const crearAlbum = (datos) => catalogoRepository.crearAlbum(datos);

export async function actualizarAlbum(id, datos) {
  return oFalla(await catalogoRepository.actualizarAlbum(id, datos), 'Álbum no encontrado');
}

export async function borrarAlbum(id) {
  oFalla(await catalogoRepository.borrarAlbum(id), 'Álbum no encontrado');
}

// ---------- Canciones ----------

export async function listarCanciones(p) {
  const [rows, total] = await Promise.all([
    catalogoRepository.listarCanciones({ ...p, offset: offset(p) }),
    catalogoRepository.contarCanciones(p),
  ]);
  return paginated(rows, p, total);
}

export async function obtenerCancion(id) {
  return oFalla(await catalogoRepository.obtenerCancion(id), 'Canción no encontrada');
}

export async function crearCancion(datos) {
  const { id } = await catalogoRepository.crearCancion(datos);
  return obtenerCancion(id);
}

export async function actualizarCancion(id, datos) {
  oFalla(await catalogoRepository.actualizarCancion(id, datos), 'Canción no encontrada');
  return obtenerCancion(id);
}

export async function borrarCancion(id) {
  oFalla(await catalogoRepository.borrarCancion(id), 'Canción no encontrada');
}
