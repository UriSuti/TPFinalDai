import { withTransaction } from '../db.js';
import * as catalogoRepository from '../repositories/catalogo.js';
import { obtenerTagsArtista } from './lastfm.js';

// Ni el export de Spotify ni los scrobbles traen géneros: se completan con los tags
// de Last.fm de cada artista. Los tags son libres ("seen live", "argentina", "80s"),
// así que se filtran los que no son géneros y se toman los 3 más fuertes.

const NO_SON_GENEROS = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'awesome', 'beautiful',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist', 'singer-songwriter',
  'albums i own', 'spotify', 'under 2000 listeners', 'all', 'cover', 'covers', 'my music',
  'argentina', 'argentinian', 'argentine', 'spanish', 'english', 'latin america', 'usa', 'american',
  'british', 'uk', 'mexico', 'chile', 'brazil', 'espanol', 'español',
]);
const MAX_GENEROS = 3;
const PESO_MINIMO = 30;
const PAUSA_MS = 250; // Last.fm pide no pasar de ~5 requests por segundo

const esDecada = (t) => /^\d{2,4}s$/.test(t) || /^\d{4}$/.test(t);

export function tagsAGeneros(tags) {
  return tags
    .map((t) => ({ ...t, nombre: t.nombre.trim().toLowerCase() }))
    .filter((t) => t.peso >= PESO_MINIMO && t.nombre && !NO_SON_GENEROS.has(t.nombre) && !esDecada(t.nombre))
    .slice(0, MAX_GENEROS)
    .map((t) => t.nombre);
}

async function guardarGeneros(artistaId, generos) {
  await withTransaction(async (client) => {
    if (generos.length) await catalogoRepository.vincularGeneros(artistaId, generos, client);
    // Se marca aunque no haya tags, para no volver a consultarlo en cada sincronización
    await catalogoRepository.marcarGenerosSincronizados(artistaId, client);
  });
}

// Procesa hasta `limite` artistas que todavía no se sincronizaron.
export async function sincronizarGeneros({ limite = 25, soloDelUsuario } = {}) {
  const pendientes = await catalogoRepository.artistasSinSincronizar(limite, soloDelUsuario);

  const resultado = { procesados: 0, conGeneros: 0, errores: [] };
  for (const [i, artista] of pendientes.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));
    try {
      const generos = tagsAGeneros(await obtenerTagsArtista(artista.nombre));
      await guardarGeneros(artista.id, generos);
      resultado.procesados++;
      if (generos.length) resultado.conGeneros++;
    } catch (err) {
      if (err.status === 404) { // Last.fm no conoce al artista: se marca y se sigue
        await guardarGeneros(artista.id, []);
        resultado.procesados++;
        continue;
      }
      resultado.errores.push({ artista: artista.nombre, error: err.message });
      if (err.status === 503) break; // sin API key o rate limit: no tiene sentido seguir
    }
  }

  return { ...resultado, pendientes: await catalogoRepository.contarArtistasSinSincronizar() };
}
