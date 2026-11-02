import { badRequest } from '../utils/errors.js';

// Convierte un archivo del export de Spotify a "eventos normalizados":
//   { fecha, artista, album, cancion, spotifyUri, ms, plataforma, aleatorio, salteada }
//
// Soporta los dos exports que da Spotify (Configuración > Privacidad > Descargar tus datos):
//   * "Extended streaming history" (Streaming_History_Audio_*.json, tarda hasta 30 días):
//       { ts, master_metadata_track_name, master_metadata_album_artist_name,
//         master_metadata_album_album_name, spotify_track_uri, ms_played, platform,
//         shuffle, skipped, ... }
//   * "Account data" (StreamingHistory_music_*.json, último año, tarda ~5 días):
//       { endTime: "2026-01-15 20:31", artistName, trackName, msPlayed }  -- en UTC
// Podcasts, audiolibros y filas sin metadata se descartan.

const texto = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);
const ms = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

function fechaValida(valor) {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizarExtendido(fila) {
  return {
    fecha: fechaValida(fila.ts),
    artista: texto(fila.master_metadata_album_artist_name),
    album: texto(fila.master_metadata_album_album_name),
    cancion: texto(fila.master_metadata_track_name),
    spotifyUri: texto(fila.spotify_track_uri),
    ms: ms(fila.ms_played),
    plataforma: texto(fila.platform),
    aleatorio: bool(fila.shuffle),
    salteada: bool(fila.skipped),
  };
}

function normalizarBasico(fila) {
  const endTime = typeof fila.endTime === 'string' ? `${fila.endTime.replace(' ', 'T')}:00Z` : null;
  return {
    fecha: fechaValida(endTime),
    artista: texto(fila.artistName),
    album: null,
    cancion: texto(fila.trackName),
    spotifyUri: null,
    ms: ms(fila.msPlayed),
    plataforma: null,
    aleatorio: null,
    salteada: null,
  };
}

export function parsearArchivoSpotify(buffer, nombreArchivo) {
  let filas;
  try {
    filas = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw badRequest(`"${nombreArchivo}" no es un JSON válido`);
  }
  if (!Array.isArray(filas)) {
    throw badRequest(`"${nombreArchivo}" no tiene el formato del historial de Spotify (se esperaba una lista)`);
  }

  const eventos = [];
  let descartadas = 0;

  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') { descartadas++; continue; }

    let evento;
    if ('ts' in fila) evento = normalizarExtendido(fila);
    else if ('endTime' in fila) evento = normalizarBasico(fila);
    else { descartadas++; continue; }

    if (!evento.fecha || !evento.artista || !evento.cancion) { descartadas++; continue; }
    eventos.push(evento);
  }

  return { eventos, leidas: filas.length, descartadas };
}
