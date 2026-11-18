import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { api, cerrar, crearUsuario, resetDb } from './helpers.js';

let ana, beto, cancion, playlist;

before(async () => {
  await resetDb();
  ana = await crearUsuario();
  beto = await crearUsuario();
  // Cualquier usuario logueado puede dar de alta una canción desde la API externa
  cancion = (await api().post('/api/canciones/resolver').set(ana.auth)
    .send({ nombre: 'Crimen', artista: 'Gustavo Cerati' }).expect(200)).body;
});
after(cerrar);

const consultar = (u) => api().get('/api/me/canciones/estado').query({ artista: 'Gustavo Cerati', nombre: 'Crimen' }).set(u.auth);

// Rutas que exigen sesión: sin token tienen que responder 401 TOKEN_AUSENTE
const RUTAS_PRIVADAS = [
  ['get', '/api/me'],
  ['patch', '/api/me'],
  ['put', '/api/me/password'],
  ['delete', '/api/me'],
  ['get', '/api/me/playlists'],
  ['post', '/api/me/playlists'],
  ['get', '/api/me/playlists/1'],
  ['get', '/api/me/favoritos'],
  ['put', '/api/me/favoritos/1'],
  ['get', '/api/me/biblioteca'],
  ['put', '/api/me/biblioteca/1'],
  ['get', '/api/me/resenas'],
  ['put', '/api/me/resenas/1'],
  ['get', '/api/me/canciones/estado?artista=a&nombre=b'],
  ['get', '/api/me/actividad'],
  ['get', '/api/me/estadisticas'],
  ['get', '/api/me/reproducciones'],
  ['get', '/api/me/importaciones'],
  ['post', '/api/me/importaciones/lastfm'],
  ['get', '/api/me/wrapped'],
  ['get', '/api/me/wrapped/2026'],
  ['get', '/api/generos'],
  ['get', '/api/artistas'],
  ['get', '/api/albumes/1'],
  ['get', '/api/canciones'],
  ['post', '/api/canciones/resolver'],
  ['post', '/api/generos/sincronizar'],
];

// Rutas de escritura del catálogo: solo admin
const RUTAS_ADMIN = [
  ['post', '/api/generos'],
  ['patch', '/api/generos/1'],
  ['delete', '/api/generos/1'],
  ['post', '/api/artistas'],
  ['patch', '/api/artistas/1'],
  ['delete', '/api/artistas/1'],
  ['put', '/api/artistas/1/generos'],
  ['post', '/api/albumes'],
  ['patch', '/api/albumes/1'],
  ['delete', '/api/albumes/1'],
  ['post', '/api/canciones'],
  ['patch', '/api/canciones/1'],
  ['delete', '/api/canciones/1'],
];

describe('protección de rutas', () => {
  test('todas las rutas privadas sin sesión -> 401 TOKEN_AUSENTE', async () => {
    for (const [metodo, ruta] of RUTAS_PRIVADAS) {
      const res = await api()[metodo](ruta);
      assert.equal(res.status, 401, `${metodo.toUpperCase()} ${ruta} debería exigir sesión`);
      assert.equal(res.body.codigo, 'TOKEN_AUSENTE', `${metodo.toUpperCase()} ${ruta}`);
    }
  });

  test('las rutas de escritura del catálogo rechazan a un usuario común -> 403', async () => {
    for (const [metodo, ruta] of RUTAS_ADMIN) {
      const res = await api()[metodo](ruta).set(ana.auth).send({});
      assert.equal(res.status, 403, `${metodo.toUpperCase()} ${ruta} debería ser solo admin`);
    }
  });
});

describe('token vencido con Authorization: Bearer', () => {
  const vencido = () => jwt.sign(
    { rol: 'usuario', exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.JWT_SECRET,
    { subject: String(ana.usuario.id) },
  );

  test('responde 401 con código TOKEN_VENCIDO en rutas privadas distintas', async () => {
    for (const ruta of ['/api/me', '/api/me/biblioteca', '/api/me/estadisticas', '/api/canciones']) {
      const res = await api().get(ruta).set('Authorization', `Bearer ${vencido()}`);
      assert.equal(res.status, 401, ruta);
      assert.equal(res.body.codigo, 'TOKEN_VENCIDO', ruta);
      assert.equal(res.body.error, 'Token vencido', ruta);
    }
  });

  test('con Bearer el server no toca ninguna cookie', async () => {
    const res = await api().get('/api/me').set('Authorization', `Bearer ${vencido()}`).expect(401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('un token vencido no da acceso a una escritura', async () => {
    await api().post('/api/me/playlists').set('Authorization', `Bearer ${vencido()}`).send({ nombre: 'Colada' }).expect(401);
    const lista = await api().get('/api/me/playlists').set(ana.auth).expect(200);
    assert.equal(lista.body.length, 0);
  });
});

describe('aislamiento de escrituras entre usuarios', () => {
  let actividadAna;

  before(async () => {
    // Ana arma su biblioteca completa
    playlist = (await api().post('/api/me/playlists').set(ana.auth).send({ nombre: 'Mía' }).expect(201)).body;
    await api().post(`/api/me/playlists/${playlist.id}/canciones`).set(ana.auth).send({ cancionId: cancion.id }).expect(201);
    await api().put(`/api/me/favoritos/${cancion.id}`).set(ana.auth).expect(201);
    await api().put(`/api/me/biblioteca/${cancion.id}`).set(ana.auth).send({ estado: 'escuchado' }).expect(200);
    await api().put(`/api/me/resenas/${cancion.id}`).set(ana.auth).send({ puntuacion: 5, comentario: 'Excelente' }).expect(200);
    actividadAna = (await api().get('/api/me/actividad').set(ana.auth).expect(200)).body.total;
  });

  test('beto no puede quitar lo que solo tiene ana -> 404', async () => {
    await api().delete(`/api/me/favoritos/${cancion.id}`).set(beto.auth).expect(404);
    await api().delete(`/api/me/biblioteca/${cancion.id}`).set(beto.auth).expect(404);
    await api().delete(`/api/me/resenas/${cancion.id}`).set(beto.auth).expect(404);
    await api().delete(`/api/me/playlists/${playlist.id}/canciones/${cancion.id}`).set(beto.auth).expect(404);
  });

  test('lo de ana queda intacto después de esos intentos', async () => {
    const r = await consultar(ana).expect(200);
    assert.equal(r.body.estado, 'escuchado');
    assert.equal(r.body.favorito, true);
    assert.deepEqual(r.body.resena, { puntuacion: 5, comentario: 'Excelente' });
    assert.deepEqual(r.body.playlists, [playlist.id]);
  });

  test('beto escribe sobre la misma canción: lo suyo es aparte y no pisa lo de ana', async () => {
    await api().put(`/api/me/biblioteca/${cancion.id}`).set(beto.auth).send({ estado: 'quiero_escuchar' }).expect(200);
    await api().put(`/api/me/resenas/${cancion.id}`).set(beto.auth).send({ puntuacion: 1, comentario: 'No me gustó' }).expect(200);

    const deBeto = await consultar(beto).expect(200);
    assert.equal(deBeto.body.estado, 'quiero_escuchar');
    assert.equal(deBeto.body.favorito, false);
    assert.deepEqual(deBeto.body.resena, { puntuacion: 1, comentario: 'No me gustó' });
    assert.deepEqual(deBeto.body.playlists, []);

    const deAna = await consultar(ana).expect(200);
    assert.equal(deAna.body.estado, 'escuchado');
    assert.deepEqual(deAna.body.resena, { puntuacion: 5, comentario: 'Excelente' });
  });

  test('las listas de beto no incluyen nada de ana y las de ana nada de beto', async () => {
    assert.equal((await api().get('/api/me/playlists').set(beto.auth).expect(200)).body.length, 0);
    assert.equal((await api().get('/api/me/favoritos').set(beto.auth).expect(200)).body.total, 0);

    const resenasAna = (await api().get('/api/me/resenas').set(ana.auth).expect(200)).body;
    assert.equal(resenasAna.total, 1);
    assert.equal(resenasAna.data[0].puntuacion, 5);
  });

  test('la actividad de beto no se mezcla con la de ana', async () => {
    const ana2 = (await api().get('/api/me/actividad').set(ana.auth).expect(200)).body;
    assert.equal(ana2.total, actividadAna); // lo que hizo beto no se le suma a ana

    const beto2 = (await api().get('/api/me/actividad').set(beto.auth).expect(200)).body;
    assert.equal(beto2.total, 2); // solo estado de biblioteca y reseña
    assert.ok(beto2.data.every((a) => ['biblioteca_agregar', 'resena_crear'].includes(a.tipo)));
  });

  test('las estadísticas de beto salen de sus datos, no de los de ana', async () => {
    const ana2 = (await api().get('/api/me/estadisticas').set(ana.auth).expect(200)).body;
    const beto2 = (await api().get('/api/me/estadisticas').set(beto.auth).expect(200)).body;
    assert.equal(ana2.favoritos, 1);
    assert.equal(beto2.favoritos, 0);
    assert.equal(ana2.resenas.promedio, 5);
    assert.equal(beto2.resenas.promedio, 1);
  });
});
