import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { api, cerrar, crearUsuario, pool, resetDb } from './helpers.js';

before(resetDb);
after(cerrar);

describe('registro y login', () => {
  test('con ?modo=tokens registra y devuelve usuario + tokens, sin password_hash', async () => {
    const res = await api().post('/api/auth/register?modo=tokens')
      .send({ nombre: 'Ramón', apellido: 'Pérez', email: 'Ramon@Mail.com', password: 'clave-segura' })
      .expect(201);
    assert.equal(res.body.usuario.email, 'Ramon@Mail.com');
    assert.equal(res.body.usuario.rol, 'usuario');
    assert.equal(res.body.usuario.password_hash, undefined);
    assert.ok(res.body.accessToken && res.body.refreshToken);
  });

  test('email duplicado (sin importar mayúsculas) -> 409', async () => {
    await api().post('/api/auth/register')
      .send({ nombre: 'Otro', apellido: 'X', email: 'ramon@mail.COM', password: 'clave-segura' })
      .expect(409);
  });

  test('body inválido -> 400 con detalle por campo', async () => {
    const res = await api().post('/api/auth/register').send({ nombre: '', email: 'nomail', password: '123' }).expect(400);
    const campos = res.body.detalles.map((d) => d.campo);
    for (const c of ['body.nombre', 'body.apellido', 'body.email', 'body.password']) assert.ok(campos.includes(c), c);
  });

  test('JSON mal formado -> 400', async () => {
    await api().post('/api/auth/login').set('content-type', 'application/json').send('{malo').expect(400);
  });

  test('login con email en otras mayúsculas funciona; password mala -> 401 genérico', async () => {
    await api().post('/api/auth/login').send({ email: 'RAMON@mail.com', password: 'clave-segura' }).expect(200);
    const mala = await api().post('/api/auth/login').send({ email: 'ramon@mail.com', password: 'otra' }).expect(401);
    const inexistente = await api().post('/api/auth/login').send({ email: 'nadie@mail.com', password: 'otra' }).expect(401);
    assert.equal(mala.body.error, inexistente.body.error); // no revela si el email existe
  });
});

describe('JWT y middleware requireAuth', () => {
  test('sin token, token basura, token con otra firma o vencido -> 401', async () => {
    await api().get('/api/me').expect(401);
    await api().get('/api/me').set('Authorization', 'Bearer basura').expect(401);
    const otraFirma = jwt.sign({ rol: 'admin' }, 'otro-secreto-cualquiera-de-32-caracteres', { subject: '1' });
    await api().get('/api/me').set('Authorization', `Bearer ${otraFirma}`).expect(401);
    const vencido = jwt.sign({ rol: 'usuario', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, { subject: '1' });
    const res = await api().get('/api/me').set('Authorization', `Bearer ${vencido}`).expect(401);
    assert.equal(res.body.error, 'Token vencido');
  });

  test('rechaza alg "none"', async () => {
    const none = jwt.sign({ rol: 'admin' }, null, { algorithm: 'none', subject: '1' });
    await api().get('/api/me').set('Authorization', `Bearer ${none}`).expect(401);
  });

  test('GET /me y PATCH /me', async () => {
    const u = await crearUsuario();
    const me = await api().get('/api/me').set(u.auth).expect(200);
    assert.equal(me.body.id, u.usuario.id);
    const upd = await api().patch('/api/me').set(u.auth).send({ lastfm_usuario: 'ramon_fm', rol: 'admin' }).expect(200);
    assert.equal(upd.body.lastfm_usuario, 'ramon_fm');
    assert.equal(upd.body.rol, 'usuario'); // campos fuera del schema se ignoran
    await api().patch('/api/me').set(u.auth).send({}).expect(400);
  });
});

describe('sesión con cookie (navegador)', () => {
  const datos = { nombre: 'Web', apellido: 'User', email: 'web@test.com', password: 'clave-segura' };
  const cookieDe = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('sesion='));
  const valorCookie = (cookie) => cookie.split(';')[0];

  test('registro: cookie HttpOnly y SameSite, sin ningún token en el body', async () => {
    const res = await api().post('/api/auth/register').send(datos).expect(201);
    assert.deepEqual(Object.keys(res.body), ['usuario']);
    const cookie = cookieDe(res);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api/);
    // Secure depende de NODE_ENV=production: en test va sin el flag
    assert.doesNotMatch(cookie, /Secure/);
  });

  test('login: la cookie autentica y no se emite refresh token', async () => {
    const res = await api().post('/api/auth/login').send({ email: datos.email, password: datos.password }).expect(200);
    assert.deepEqual(Object.keys(res.body), ['usuario']);
    const me = await api().get('/api/me').set('Cookie', valorCookie(cookieDe(res))).expect(200);
    assert.equal(me.body.email, datos.email);
    const { rowCount } = await pool.query('SELECT 1 FROM public.refresh_tokens WHERE usuario_id = $1', [me.body.id]);
    assert.equal(rowCount, 0);
  });

  test('login fallido: 401 sin código de sesión ni cookie', async () => {
    const res = await api().post('/api/auth/login').send({ email: datos.email, password: 'mala' }).expect(401);
    assert.equal(res.body.codigo, undefined);
    assert.equal(cookieDe(res), undefined);
  });

  test('códigos de sesión: ausente, inválido y vencido; el vencido lo rechaza el server y borra la cookie', async () => {
    const ausente = await api().get('/api/me').expect(401);
    assert.equal(ausente.body.codigo, 'TOKEN_AUSENTE');

    const invalido = await api().get('/api/me').set('Cookie', 'sesion=basura').expect(401);
    assert.equal(invalido.body.codigo, 'TOKEN_INVALIDO');

    const token = jwt.sign({ rol: 'usuario', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, { subject: '1' });
    const vencido = await api().get('/api/me').set('Cookie', `sesion=${token}`).expect(401);
    assert.equal(vencido.body.codigo, 'TOKEN_VENCIDO');
    assert.match(cookieDe(vencido), /Expires=Thu, 01 Jan 1970/);
  });

  test('un 401 de negocio no se confunde con uno de sesión', async () => {
    const login = await api().post('/api/auth/login').send({ email: datos.email, password: datos.password }).expect(200);
    const cookie = valorCookie(cookieDe(login));
    const res = await api().put('/api/me/password').set('Cookie', cookie).send({ actual: 'mala', nueva: 'nueva-clave-123' }).expect(401);
    assert.equal(res.body.codigo, undefined);
    assert.equal(cookieDe(res), undefined);
  });

  test('logout sin body borra la cookie', async () => {
    const res = await api().post('/api/auth/logout').expect(204);
    assert.match(cookieDe(res), /Expires=Thu, 01 Jan 1970/);
  });

  test('CORS: permite credenciales solo a los orígenes configurados', async () => {
    const ok = await api().get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(ok.headers['access-control-allow-credentials'], 'true');
    const otro = await api().get('/api/health').set('Origin', 'https://malicioso.example').expect(200);
    assert.equal(otro.headers['access-control-allow-origin'], undefined);
  });
});

describe('refresh tokens', () => {
  test('rotación: el refresh nuevo sirve, el viejo no', async () => {
    const u = await crearUsuario();
    const r1 = await api().post('/api/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
    assert.notEqual(r1.body.refreshToken, u.refreshToken);
    await api().get('/api/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(200);

    // Reusar el viejo = robo: revoca TODAS las sesiones, incluida la nueva
    const reuso = await api().post('/api/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    assert.match(reuso.body.error, /reutilizado/);
    await api().post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
  });

  test('solo se guarda el hash del refresh token', async () => {
    const u = await crearUsuario();
    const { rows } = await pool.query('SELECT token_hash FROM public.refresh_tokens WHERE usuario_id = $1', [u.usuario.id]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, u.refreshToken);
    assert.equal(rows[0].token_hash.length, 64);
  });

  test('refresh vencido -> 401', async () => {
    const u = await crearUsuario();
    await pool.query("UPDATE public.refresh_tokens SET expira_en = now() - interval '1 minute' WHERE usuario_id = $1", [u.usuario.id]);
    const res = await api().post('/api/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    assert.equal(res.body.error, 'Refresh token vencido');
  });

  test('logout revoca el refresh', async () => {
    const u = await crearUsuario();
    await api().post('/api/auth/logout').send({ refreshToken: u.refreshToken }).expect(204);
    await api().post('/api/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
  });

  test('cambiar la contraseña cierra todas las sesiones', async () => {
    const u = await crearUsuario();
    await api().put('/api/me/password').set(u.auth).send({ actual: 'incorrecta', nueva: 'nueva-clave-123' }).expect(401);
    await api().put('/api/me/password').set(u.auth).send({ actual: u.password, nueva: 'nueva-clave-123' }).expect(204);
    await api().post('/api/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    await api().post('/api/auth/login').send({ email: u.usuario.email, password: 'nueva-clave-123' }).expect(200);
  });

  test('borrar la cuenta pide contraseña y borra en cascada', async () => {
    const u = await crearUsuario();
    await api().delete('/api/me').set(u.auth).send({ password: 'mal' }).expect(401);
    await api().delete('/api/me').set(u.auth).send({ password: u.password }).expect(204);
    const { rowCount } = await pool.query('SELECT 1 FROM public.refresh_tokens WHERE usuario_id = $1', [u.usuario.id]);
    assert.equal(rowCount, 0);
  });
});

test('ruta inexistente -> 404 (no 401)', async () => {
  await api().get('/no-existe').expect(404);
  await api().get('/api/no-existe').expect(404);
  await api().get('/api/health').expect(200);
});

test('todas las rutas van bajo /api: sin el prefijo -> 404', async () => {
  await api().get('/health').expect(404);
  await api().post('/auth/login').send({ email: 'a@b.com', password: 'x' }).expect(404);
  await api().get('/me').expect(404);
  await api().get('/canciones').expect(404);
});
