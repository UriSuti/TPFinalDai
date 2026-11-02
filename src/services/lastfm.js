import { config } from '../config.js';
import { AppError, badGateway, notFound } from '../utils/errors.js';

// Cliente mínimo de la API de Last.fm (https://www.last.fm/api).
// Solo hace falta una API key gratuita; los datos de escucha de un usuario son públicos.

export const lastfmDisponible = () => Boolean(config.LASTFM_API_KEY);

async function llamar(metodo, params) {
  if (!lastfmDisponible()) throw new AppError(503, 'Last.fm no está configurado (falta LASTFM_API_KEY)');

  const url = new URL(config.LASTFM_BASE_URL);
  url.search = new URLSearchParams({ method: metodo, api_key: config.LASTFM_API_KEY, format: 'json', ...params });

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw badGateway('No se pudo conectar con Last.fm');
  }

  const body = await res.json().catch(() => null);
  if (body?.error) {
    // 6 = usuario/artista inexistente, 29 = rate limit
    if (body.error === 6) throw notFound(`Last.fm: ${body.message}`);
    if (body.error === 29) throw new AppError(503, 'Last.fm: límite de requests, probá en un rato');
    throw badGateway(`Last.fm: ${body.message}`);
  }
  if (!res.ok || !body) throw badGateway(`Last.fm respondió ${res.status}`);
  return body;
}

// Last.fm devuelve un objeto suelto en vez de una lista cuando hay un solo resultado.
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function aEvento(t) {
  return {
    fecha: new Date(Number(t.date.uts) * 1000).toISOString(),
    artista: t.artist?.['#text']?.trim() || null,
    album: t.album?.['#text']?.trim() || null,
    cancion: t.name?.trim() || null,
    spotifyUri: null,
    ms: null,
    plataforma: null,
    aleatorio: null,
    salteada: null,
  };
}

// Trae scrobbles de un usuario entre dos fechas, de a 200 por página (máximo de la API).
//
// Last.fm ordena del más nuevo al más viejo (página 1 = lo último). Para que la
// sincronización incremental funcione se recorre AL REVÉS (de lo más viejo a lo más
// nuevo) y con "hasta" fijo, así las páginas no se corren si el usuario scrobblea
// mientras tanto. maxPaginas acota cada llamada (50 páginas = 10.000 scrobbles):
// si queda algo, completo = false y la próxima sincronización sigue desde ahí.
export async function obtenerScrobbles(usuario, { desde, hasta, maxPaginas = 50 } = {}) {
  const params = { user: usuario, limit: '200', to: String(Math.floor((hasta ?? new Date()).getTime() / 1000)) };
  if (desde) params.from = String(Math.floor(desde.getTime() / 1000));

  const pagina = async (n) => {
    const body = await llamar('user.getrecenttracks', { ...params, page: String(n) });
    return {
      total: Number(body.recenttracks?.['@attr']?.totalPages ?? 0),
      tracks: lista(body.recenttracks?.track).filter((t) => t['@attr']?.nowplaying !== 'true' && t.date?.uts),
    };
  };

  const primera = await pagina(1);
  const totalPaginas = primera.total;
  const hastaPagina = Math.max(1, totalPaginas - maxPaginas + 1);

  const eventos = [];
  for (let n = totalPaginas; n >= hastaPagina; n--) {
    const { tracks } = n === 1 ? primera : await pagina(n);
    eventos.push(...tracks.map(aEvento));
  }
  return { eventos, completo: hastaPagina === 1 };
}

// Tags más usados para un artista (Last.fm los usa como géneros). count va de 0 a 100.
export async function obtenerTagsArtista(nombre) {
  const body = await llamar('artist.gettoptags', { artist: nombre, autocorrect: '1' });
  return lista(body.toptags?.tag).map((t) => ({ nombre: t.name, peso: Number(t.count) }));
}
