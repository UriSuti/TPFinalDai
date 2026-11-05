import * as historialRepository from '../repositories/historial.js';
import * as usuariosRepository from '../repositories/usuarios.js';
import { badRequest, notFound } from '../utils/errors.js';
import { offset, paginated } from '../utils/pagination.js';
import { importarEventos } from './importador.js';
import { obtenerScrobbles } from './lastfm.js';
import { parsearArchivoSpotify } from './spotifyParser.js';

// Historial de escucha del usuario logueado: reproducciones e importaciones.

// ---------- Reproducciones ----------

export async function listarReproducciones(usuarioId, p) {
  const filtro = { usuarioId, desde: p.desde, hasta: p.hasta };
  const [rows, total] = await Promise.all([
    historialRepository.listarReproducciones({ ...filtro, limit: p.limit, offset: offset(p) }),
    historialRepository.contarReproducciones(filtro),
  ]);
  return paginated(rows, p, total);
}

export const crearReproduccion = (usuarioId, datos) => historialRepository.crearReproduccion({ usuarioId, ...datos });

export async function borrarReproduccion(id, usuarioId) {
  if (!(await historialRepository.borrarReproduccion(id, usuarioId))) throw notFound('Reproducción no encontrada');
}

// ---------- Importaciones ----------

export const listarImportaciones = (usuarioId) => historialRepository.listarImportaciones(usuarioId);

// archivos: [{ nombre, contenido }]. Cada uno genera su propia importación (se puede deshacer por separado).
export async function importarSpotify(usuarioId, archivos) {
  // Primero se parsean todos: si uno está mal, no se importa ninguno
  const parseados = archivos.map((a) => ({ archivo: a.nombre, ...parsearArchivoSpotify(a.contenido, a.nombre) }));
  if (parseados.every((p) => p.eventos.length === 0)) {
    throw badRequest('Los archivos no tienen reproducciones de música (¿son del export de Spotify?)');
  }

  const importaciones = [];
  for (const p of parseados) {
    importaciones.push(await importarEventos({
      usuarioId,
      fuente: 'spotify',
      detalle: p.archivo,
      eventos: p.eventos,
      leidas: p.leidas,
      descartadas: p.descartadas,
    }));
  }
  return importaciones;
}

// Sincroniza scrobbles de Last.fm. Sin "desde", sigue desde el último scrobble importado.
export async function importarLastfm(usuarioId, { usuario, desde: desdeIso, hasta }) {
  const usuarioLastfm = usuario ?? await usuariosRepository.obtenerUsuarioLastfm(usuarioId);
  if (!usuarioLastfm) throw badRequest('Indicá tu usuario de Last.fm (campo "usuario") o guardalo en tu perfil');

  let desde = desdeIso ? new Date(desdeIso) : null;
  if (!desde) {
    const ultima = await historialRepository.ultimaFechaLastfm(usuarioId);
    if (ultima) desde = new Date(ultima.getTime() + 1000);
  }

  const { eventos, completo } = await obtenerScrobbles(usuarioLastfm, {
    desde,
    hasta: hasta ? new Date(hasta) : null,
  });
  const validos = eventos.filter((e) => e.artista && e.cancion);

  // Si funcionó, se guarda el usuario en el perfil para la próxima
  await usuariosRepository.guardarUsuarioLastfm(usuarioId, usuarioLastfm);

  const importacion = await importarEventos({
    usuarioId,
    fuente: 'lastfm',
    detalle: `last.fm/user/${usuarioLastfm}`,
    eventos: validos,
    leidas: eventos.length,
    descartadas: eventos.length - validos.length,
  });
  // completo = false: había más de 10.000 scrobbles; volver a llamar trae el resto
  return { ...importacion, completo };
}

// Deshacer: borra la importación y todas sus reproducciones
export async function borrarImportacion(id, usuarioId) {
  if (!(await historialRepository.borrarImportacion(id, usuarioId))) throw notFound('Importación no encontrada');
}
