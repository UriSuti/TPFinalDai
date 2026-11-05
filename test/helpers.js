// Se importa ANTES que la app: fija el entorno de test y levanta un Last.fm falso.
import fs from 'node:fs';
import http from 'node:http';

const LASTFM_PORT = 4555;
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/spotify_wrapped_test';
process.env.JWT_SECRET = 'secreto-de-test-con-mas-de-32-caracteres!!';
process.env.BCRYPT_ROUNDS = '4';
process.env.LASTFM_API_KEY = 'clave-falsa';
process.env.LASTFM_BASE_URL = `http://127.0.0.1:${LASTFM_PORT}/2.0/`;

const { pool } = await import('../src/db.js');
const { app } = await import('../src/app.js');
const supertest = (await import('supertest')).default;

export { app, pool };
export const api = () => supertest(app);

// Base limpia: se borra todo y se vuelve a cargar db/schema.sql
export async function resetDb() {
  const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await client.query(sql);
  } finally {
    await client.query('SET search_path = public'); // el dump lo deja vacío en esa conexión
    client.release();
  }
}

let n = 0;
export async function crearUsuario(extra = {}) {
  n++;
  const body = { nombre: 'Test', apellido: `User${n}`, email: `user${n}@test.com`, password: 'password123', ...extra };
  const res = await api().post('/api/auth/register').send(body).expect(201);
  return { ...res.body, auth: { Authorization: `Bearer ${res.body.accessToken}` }, password: body.password };
}

export async function crearAdmin() {
  const u = await crearUsuario();
  await pool.query("UPDATE public.usuarios SET rol = 'admin' WHERE id = $1", [u.usuario.id]);
  // El rol viaja en el JWT: hay que volver a loguearse para que el token lo tenga
  const res = await api().post('/api/auth/login').send({ email: u.usuario.email, password: u.password }).expect(200);
  return { ...res.body, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

// ---------- Last.fm falso ----------
// lastfm.scrobbles: lista del más nuevo al más viejo (como la API real)
// lastfm.tags: { [artista]: [{ name, count }] }
export const lastfm = { scrobbles: [], tags: {}, llamadas: [] };

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = Object.fromEntries(url.searchParams);
  lastfm.llamadas.push(p);
  res.setHeader('content-type', 'application/json');

  if (p.method === 'user.getrecenttracks') {
    if (p.user === 'noexiste') return res.end(JSON.stringify({ error: 6, message: 'User not found' }));
    const from = Number(p.from ?? 0);
    const to = Number(p.to ?? Infinity);
    const filtrados = lastfm.scrobbles.filter((s) => s.uts >= from && s.uts <= to);
    const limit = Number(p.limit);
    const page = Number(p.page);
    const totalPages = Math.ceil(filtrados.length / limit);
    const track = filtrados.slice((page - 1) * limit, page * limit).map((s) => ({
      artist: { '#text': s.artista },
      album: { '#text': s.album ?? '' },
      name: s.cancion,
      date: { uts: String(s.uts) },
    }));
    return res.end(JSON.stringify({ recenttracks: { track, '@attr': { totalPages: String(totalPages), page: String(page) } } }));
  }

  if (p.method === 'artist.gettoptags') {
    const tags = lastfm.tags[p.artist];
    if (!tags) return res.end(JSON.stringify({ error: 6, message: 'The artist you supplied could not be found' }));
    return res.end(JSON.stringify({ toptags: { tag: tags } }));
  }

  res.end(JSON.stringify({ error: 3, message: 'Invalid Method' }));
});

await new Promise((r) => servidor.listen(LASTFM_PORT, '127.0.0.1', r));

export async function cerrar() {
  await pool.end();
  await new Promise((r) => servidor.close(r));
}
