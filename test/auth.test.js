import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { api, cerrar, crearUsuario, pool, resetDb } from './helpers.js';

before(resetDb);
after(cerrar);

describe('registro y login', () => {
  test('registra y devuelve usuario + tokens, sin password_hash', async () => {
    const res = await api().post('/api/auth/register')
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
