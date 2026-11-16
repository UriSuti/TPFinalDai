import { withTransaction } from '../db.js';
import * as actividadRepository from '../repositories/actividad.js';
import * as bibliotecaRepository from '../repositories/biblioteca.js';
import { notFound } from '../utils/errors.js';
import { offset, paginated } from '../utils/pagination.js';

// Biblioteca del usuario logueado: playlists propias, favoritos, estados y reseñas.
// Si una playlist es de otro, se responde 404 (no 403) para no revelar que existe.
// Cada cambio se registra en actividad dentro de la misma transacción.

async function exigirPlaylistPropia(id, usuarioId, db) {
  const playlist = await bibliotecaRepository.obtenerPlaylistPropia(id, usuarioId, db);
  if (!playlist) throw notFound('Playlist no encontrada');
  return playlist;
}

// Registra una acción sobre una canción guardando su nombre y artista en el detalle.
async function registrarCancion(db, usuarioId, tipo, cancionId, extra = {}) {
  const cancion = await bibliotecaRepository.datosCancion(cancionId, db);
  await actividadRepository.registrar({
    usuarioId,
    tipo,
    cancionId,
    playlistId: extra.playlistId ?? null,
    detalle: { cancion: cancion?.nombre, artista: cancion?.artista, ...extra.detalle },
  }, db);
}

// ---------- Playlists ----------

export const listarPlaylists = (usuarioId) => bibliotecaRepository.listarPlaylists(usuarioId);

export const crearPlaylist = (usuarioId, nombre) => withTransaction(async (db) => {
  const playlist = await bibliotecaRepository.crearPlaylist(usuarioId, nombre, db);
  await actividadRepository.registrar({
    usuarioId, tipo: 'playlist_crear', playlistId: playlist.id, detalle: { playlist: nombre },
  }, db);
  return playlist;
});

export async function obtenerPlaylist(id, usuarioId) {
  const playlist = await bibliotecaRepository.obtenerPlaylist(id, usuarioId);
  if (!playlist) throw notFound('Playlist no encontrada');
  return playlist;
}

export const renombrarPlaylist = (id, usuarioId, nombre) => withTransaction(async (db) => {
  const anterior = await exigirPlaylistPropia(id, usuarioId, db);
  const playlist = await bibliotecaRepository.renombrarPlaylist(id, usuarioId, nombre, db);
  if (anterior.nombre !== nombre) {
    await actividadRepository.registrar({
      usuarioId, tipo: 'playlist_renombrar', playlistId: id, detalle: { playlist: nombre, anterior: anterior.nombre },
    }, db);
  }
  return playlist;
});

export const borrarPlaylist = (id, usuarioId) => withTransaction(async (db) => {
  const playlist = await bibliotecaRepository.borrarPlaylist(id, usuarioId, db);
  if (!playlist) throw notFound('Playlist no encontrada');
  // playlist_id queda en NULL: la playlist ya no existe
  await actividadRepository.registrar({
    usuarioId, tipo: 'playlist_borrar', detalle: { playlist: playlist.nombre },
  }, db);
});

// Devuelve si se agregó (false = ya estaba). Si la canción no existe, la FK tira 23503
// y el errorHandler responde 400.
export const agregarCancion = (playlistId, usuarioId, cancionId) => withTransaction(async (db) => {
  const playlist = await exigirPlaylistPropia(playlistId, usuarioId, db);
  const agregada = (await bibliotecaRepository.agregarCancion(playlistId, cancionId, db)) === 1;
  if (agregada) {
    await registrarCancion(db, usuarioId, 'playlist_agregar_cancion', cancionId, {
      playlistId, detalle: { playlist: playlist.nombre },
    });
  }
  return agregada;
});

export const quitarCancion = (playlistId, usuarioId, cancionId) => withTransaction(async (db) => {
  const playlist = await exigirPlaylistPropia(playlistId, usuarioId, db);
  if (!(await bibliotecaRepository.quitarCancion(playlistId, cancionId, db))) {
    throw notFound('La canción no está en la playlist');
  }
  await registrarCancion(db, usuarioId, 'playlist_quitar_cancion', cancionId, {
    playlistId, detalle: { playlist: playlist.nombre },
  });
});

// ---------- Favoritos ----------

export async function listarFavoritos(usuarioId, p) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarFavoritos(usuarioId, { limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarFavoritos(usuarioId),
  ]);
  return paginated(rows, p, total);
}

// Idempotente: marcar dos veces como favorito no falla. Devuelve si es nuevo.
export const agregarFavorito = (usuarioId, cancionId) => withTransaction(async (db) => {
  const nuevo = (await bibliotecaRepository.agregarFavorito(usuarioId, cancionId, db)) === 1;
  if (nuevo) await registrarCancion(db, usuarioId, 'favorito_agregar', cancionId);
  return nuevo;
});

export const quitarFavorito = (usuarioId, cancionId) => withTransaction(async (db) => {
  if (!(await bibliotecaRepository.quitarFavorito(usuarioId, cancionId, db))) {
    throw notFound('La canción no estaba en favoritos');
  }
  await registrarCancion(db, usuarioId, 'favorito_quitar', cancionId);
});

// ---------- Biblioteca (estado de cada canción) ----------

export async function listarBiblioteca(usuarioId, { estado, ...p }) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarBiblioteca(usuarioId, { estado, limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarBiblioteca(usuarioId, estado),
  ]);
  return paginated(rows, p, total);
}

// Si la canción no existe, la FK tira 23503 y el errorHandler responde 400.
// Volver a guardar el mismo estado no genera actividad.
export const guardarEnBiblioteca = (usuarioId, cancionId, estado) => withTransaction(async (db) => {
  const anterior = await bibliotecaRepository.obtenerEstado(usuarioId, cancionId, db);
  const fila = await bibliotecaRepository.guardarEnBiblioteca(usuarioId, cancionId, estado, db);
  if (anterior !== estado) {
    await registrarCancion(db, usuarioId, anterior ? 'biblioteca_estado' : 'biblioteca_agregar', cancionId, {
      detalle: { estado, anterior: anterior ?? null },
    });
  }
  return fila;
});

export const quitarDeBiblioteca = (usuarioId, cancionId) => withTransaction(async (db) => {
  if (!(await bibliotecaRepository.quitarDeBiblioteca(usuarioId, cancionId, db))) {
    throw notFound('La canción no estaba en la biblioteca');
  }
  await registrarCancion(db, usuarioId, 'biblioteca_quitar', cancionId);
});

// ---------- Reseñas ----------

export async function listarResenas(usuarioId, p) {
  const [rows, total] = await Promise.all([
    bibliotecaRepository.listarResenas(usuarioId, { limit: p.limit, offset: offset(p) }),
    bibliotecaRepository.contarResenas(usuarioId),
  ]);
  return paginated(rows, p, total);
}

export const guardarResena = (usuarioId, cancionId, datos) => withTransaction(async (db) => {
  const anterior = await bibliotecaRepository.obtenerResena(usuarioId, cancionId, db);
  const resena = await bibliotecaRepository.guardarResena(usuarioId, cancionId, datos, db);
  await registrarCancion(db, usuarioId, anterior ? 'resena_editar' : 'resena_crear', cancionId, {
    detalle: { puntuacion: resena.puntuacion, conComentario: Boolean(resena.comentario) },
  });
  return resena;
});

export const quitarResena = (usuarioId, cancionId) => withTransaction(async (db) => {
  if (!(await bibliotecaRepository.quitarResena(usuarioId, cancionId, db))) {
    throw notFound('No hay una reseña para esa canción');
  }
  await registrarCancion(db, usuarioId, 'resena_borrar', cancionId);
});

// ---------- Relación del usuario con una canción ----------

// Si la canción todavía no está en el catálogo, el usuario no tiene nada guardado sobre ella.
export async function relacionConCancion(usuarioId, artista, nombre) {
  const fila = await bibliotecaRepository.relacionConCancion(usuarioId, artista, nombre);
  return fila ?? { id: null, estado: null, favorito: false, resena: null, playlists: [] };
}
