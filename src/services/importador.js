import { withTransaction } from '../db.js';
import * as importadorRepository from '../repositories/importador.js';

const LOTE = 5000;

// Guarda eventos normalizados (ver spotifyParser.js / lastfm.js) en una sola transacción:
//   1. crea la fila en importaciones
//   2. da de alta artistas, álbumes y canciones que no existan (clave natural, sin duplicar)
//   3. inserta las reproducciones; las repetidas se ignoran (reproducciones_uq)
export async function importarEventos({ usuarioId, fuente, detalle, eventos, leidas, descartadas }) {
  const resultado = await guardar({ usuarioId, fuente, detalle, eventos, leidas, descartadas });
  // Después de cargar miles de filas, las estadísticas del planificador quedan viejas
  // hasta que corra autovacuum y las vistas wrapped_* pueden elegir planes malísimos.
  if (resultado.filas_insertadas > 1000) await importadorRepository.analizar();
  return resultado;
}

function guardar({ usuarioId, fuente, detalle, eventos, leidas, descartadas }) {
  return withTransaction(async (client) => {
    const imp = await importadorRepository.crearImportacion({ usuarioId, fuente, detalle, leidas, descartadas }, client);

    let insertadas = 0;
    for (let i = 0; i < eventos.length; i += LOTE) {
      insertadas += await importarLote(client, usuarioId, fuente, imp.id, eventos.slice(i, i + LOTE));
    }

    const resultado = await importadorRepository.finalizarImportacion(imp.id, insertadas, client);
    // Las que ya estaban cargadas no se insertan de nuevo
    resultado.filas_duplicadas = eventos.length - insertadas;
    return resultado;
  });
}

async function importarLote(client, usuarioId, fuente, importacionId, eventos) {
  // 1. Artistas
  const nombresArtistas = [...new Set(eventos.map((e) => e.artista))];
  await importadorRepository.insertarArtistas(nombresArtistas, client);
  const artistas = await importadorRepository.idsDeArtistas(nombresArtistas, client);
  const idArtista = new Map(artistas.map((r) => [r.original, r.id]));

  // 2. Álbumes
  const clavesAlbum = new Map();
  for (const e of eventos) {
    if (e.album) clavesAlbum.set(`${idArtista.get(e.artista)}|${e.album}`, [idArtista.get(e.artista), e.album]);
  }
  const albumArtistas = [...clavesAlbum.values()].map(([a]) => a);
  const albumNombres = [...clavesAlbum.values()].map(([, n]) => n);
  await importadorRepository.insertarAlbumes(albumArtistas, albumNombres, client);
  const albumes = await importadorRepository.idsDeAlbumes(albumArtistas, albumNombres, client);
  const idAlbum = new Map(albumes.map((r) => [`${r.a}|${r.n}`, r.id]));

  // 3. Canciones
  const clavesCancion = new Map();
  for (const e of eventos) {
    const a = idArtista.get(e.artista);
    const clave = `${a}|${e.cancion}`;
    const previa = clavesCancion.get(clave);
    clavesCancion.set(clave, {
      a,
      n: e.cancion,
      album: previa?.album ?? (e.album ? idAlbum.get(`${a}|${e.album}`) : null),
      uri: previa?.uri ?? e.spotifyUri,
    });
  }
  const canciones = [...clavesCancion.values()];
  await importadorRepository.insertarCanciones(canciones, client);
  const idsCanciones = await importadorRepository.idsDeCanciones(canciones, client);
  const idCancion = new Map(idsCanciones.map((r) => [`${r.a}|${r.n}`, r.id]));

  // 4. Reproducciones
  const reproducciones = eventos.map((e) => ({
    cancionId: idCancion.get(`${idArtista.get(e.artista)}|${e.cancion}`),
    fecha: e.fecha,
    ms: e.ms,
    plataforma: e.plataforma,
    aleatorio: e.aleatorio,
    salteada: e.salteada,
  }));
  return importadorRepository.insertarReproducciones({ usuarioId, importacionId, fuente, reproducciones }, client);
}
