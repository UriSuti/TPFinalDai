import * as bibliotecaRepository from '../repositories/biblioteca.js';
import { notFound } from '../utils/errors.js';
import { offset, paginated } from '../utils/pagination.js';

// Biblioteca del usuario logueado: playlists propias, favoritos, estados y reseñas.
// Si una playlist es de otro, se responde 404 (no 403) para no revelar que existe.

async function exigirPlaylistPropia(id, usuarioId) {
  if (!(await bibliotecaRepository.esPlaylistPropia(id, usuarioId))) throw notFound('Playlist no encontrada');
}

// ---------- Playlists ----------

export const listarPlaylists = (usuarioId) => bibliotecaRepository.listarPlaylists(usuarioId);

export const crearPlaylist = (usuarioId, nombre) => bibliotecaRepository.crearPlaylist(usuarioId, nombre);

export async function obtenerPlaylist(id, usuarioId) {
  const playlist = await bibliotecaRepository.obtenerPlaylist(id, usuarioId);
  if (!playlist) throw notFound('Playlist no encontrada');
  return playlist;
}

export async function renombrarPlaylist(id, usuarioId, nombre) {
  const playlist = await bibliotecaRepository.renombrarPlaylist(id, usuarioId, nombre);
  if (!playlist) throw notFound('Playlist no encontrada');
  return playlist;
}

export async function borrarPlaylist(id, usuarioId) {
  if (!(await bibliotecaRepository.borrarPlaylist(id, usuarioId))) throw notFound('Playlist no encontrada');
}

// Devuelve si se agregó (false = ya estaba). Si la canción no existe, la FK tira 23503
// y el errorHandler responde 400.
export async function agregarCancion(playlistId, usuarioId, cancionId) {
  await exigirPlaylistPropia(playlistId, usuarioId);
  return (await bibliotecaRepository.agregarCancion(playlistId, cancionId)) === 1;
}

export async function quitarCancion(playlistId, usuarioId, cancionId) {
  await exigirPlaylistPropia(playlistId, usuarioId);
  if (!(await bibliotecaRepository.quitarCancion(playlistId, cancionId))) {
    throw notFound('La canción no está en la playlist');
  }
}

// ---------- Favoritos ----------

export async function listarFavoritos(usuarioId, p) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarFavoritos(usuarioId, { limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarFavoritos(usuarioId),
  ]);
  return paginated(rows, p, total);
}

// Idempotente: marcar dos veces como favorito no falla. Devuelve si es nuevo.
export async function agregarFavorito(usuarioId, cancionId) {
  return (await bibliotecaRepository.agregarFavorito(usuarioId, cancionId)) === 1;
}

export async function quitarFavorito(usuarioId, cancionId) {
  if (!(await bibliotecaRepository.quitarFavorito(usuarioId, cancionId))) {
    throw notFound('La canción no estaba en favoritos');
  }
}

// ---------- Biblioteca (estado de cada canción) ----------

export async function listarBiblioteca(usuarioId, { estado, ...p }) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarBiblioteca(usuarioId, { estado, limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarBiblioteca(usuarioId, estado),
  ]);
  return paginated(rows, p, total);
}

// Si la canción no existe, la FK tira 23503 y el errorHandler responde 400.
export const guardarEnBiblioteca = (usuarioId, cancionId, estado) => (
  bibliotecaRepository.guardarEnBiblioteca(usuarioId, cancionId, estado)
);

export async function quitarDeBiblioteca(usuarioId, cancionId) {
  if (!(await bibliotecaRepository.quitarDeBiblioteca(usuarioId, cancionId))) {
    throw notFound('La canción no estaba en la biblioteca');
  }
}

// ---------- Reseñas ----------

export async function listarResenas(usuarioId, p) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarResenas(usuarioId, { limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarResenas(usuarioId),
  ]);
  return paginated(rows, p, total);
}

export const guardarResena = (usuarioId, cancionId, datos) => (
  bibliotecaRepository.guardarResena(usuarioId, cancionId, datos)
);

export async function quitarResena(usuarioId, cancionId) {
  if (!(await bibliotecaRepository.quitarResena(usuarioId, cancionId))) throw notFound('No hay una reseña para esa canción');
}

// ---------- Relación del usuario con una canción ----------

// Si la canción todavía no está en el catálogo, el usuario no tiene nada guardado sobre ella.
export async function relacionConCancion(usuarioId, artista, nombre) {
  const fila = await bibliotecaRepository.relacionConCancion(usuarioId, artista, nombre);
  return fila ?? { id: null, estado: null, favorito: false, resena: null, playlists: [] };
}
