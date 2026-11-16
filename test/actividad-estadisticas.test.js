import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, cerrar, crearUsuario, resetDb } from './helpers.js';

after(cerrar);

let ana;
let beto;
let c1;
let c2;

const resolver = async (u, nombre, artista) => (
  await api().post('/api/canciones/resolver').set(u.auth).send({ nombre, artista }).expect(200)
).body;

before(async () => {
  await resetDb();
  ana = await crearUsuario();
  beto = await crearUsuario();
  c1 = await resolver(ana, 'Crimen', 'Gustavo Cerati');
  c2 = await resolver(ana, 'Karma Police', 'Radiohead');
});

const actividadDe = async (u, query = '') => (await api().get(`/api/me/actividad${query}`).set(u.auth).expect(200)).body;

describe('actividad', () => {
  test('cada acción queda registrada, la más nueva primero', async () => {
    await api().put(`/api/me/biblioteca/${c1.id}`).set(ana.auth).send({ estado: 'quiero_escuchar' }).expect(200);
    await api().put(`/api/me/biblioteca/${c1.id}`).set(ana.auth).send({ estado: 'escuchado' }).expect(200);
    await api().put(`/api/me/favoritos/${c1.id}`).set(ana.auth).expect(201);
    await api().put(`/api/me/resenas/${c1.id}`).set(ana.auth).send({ puntuacion: 5 }).expect(200);
    await api().put(`/api/me/resenas/${c1.id}`).set(ana.auth).send({ comentario: 'Hermosa' }).expect(200);
    const p = (await api().post('/api/me/playlists').set(ana.auth).send({ nombre: 'Mix' }).expect(201)).body;
    await api().post(`/api/me/playlists/${p.id}/canciones`).set(ana.auth).send({ cancionId: c1.id }).expect(201);
    await api().patch(`/api/me/playlists/${p.id}`).set(ana.auth).send({ nombre: 'Mix 2' }).expect(200);
    await api().delete(`/api/me/playlists/${p.id}`).set(ana.auth).expect(204);

    const { data, total } = await actividadDe(ana);
    assert.deepEqual(data.map((a) => a.tipo), [
      'playlist_borrar', 'playlist_renombrar', 'playlist_agregar_cancion', 'playlist_crear',
      'resena_editar', 'resena_crear', 'favorito_agregar', 'biblioteca_estado', 'biblioteca_agregar',
    ]);
    assert.equal(total, 9);
    // La playlist ya no existe, pero la actividad conserva el nombre
    assert.equal(data[0].playlist_id, null);
    assert.equal(data[0].detalle.playlist, 'Mix 2');
    assert.equal(data[7].detalle.estado, 'escuchado');
    assert.equal(data[7].detalle.anterior, 'quiero_escuchar');
    assert.equal(data[7].cancion.nombre, 'Crimen');
  });

  test('repetir una acción sin cambios no genera actividad', async () => {
    const antes = (await actividadDe(ana)).total;
    await api().put(`/api/me/biblioteca/${c1.id}`).set(ana.auth).send({ estado: 'escuchado' }).expect(200);
    await api().put(`/api/me/favoritos/${c1.id}`).set(ana.auth).expect(200);
    assert.equal((await actividadDe(ana)).total, antes);
  });

  test('si la acción falla no queda actividad (misma transacción)', async () => {
    const antes = (await actividadDe(ana)).total;
    await api().put('/api/me/biblioteca/99999').set(ana.auth).send({ estado: 'escuchado' }).expect(400);
    await api().delete(`/api/me/favoritos/${c2.id}`).set(ana.auth).expect(404);
    assert.equal((await actividadDe(ana)).total, antes);
  });

  test('filtro por tipo y separación entre usuarios', async () => {
    const resenas = await actividadDe(ana, '?tipo=resena');
    assert.ok(resenas.data.every((a) => a.tipo.startsWith('resena_')));
    assert.equal(resenas.total, 2);
    assert.equal((await actividadDe(beto)).total, 0);
    await api().get('/api/me/actividad?tipo=otra').set(ana.auth).expect(400);
    await api().get('/api/me/actividad').expect(401);
  });
});

describe('estadísticas de la biblioteca', () => {
  test('usuario nuevo: todo en cero, sin errores', async () => {
    const u = await crearUsuario();
    const { body } = await api().get('/api/me/estadisticas').set(u.auth).expect(200);
    assert.equal(body.biblioteca.total, 0);
    assert.equal(body.biblioteca.porcentajeEscuchado, 0);
    assert.equal(body.resenas.promedio, null);
    assert.equal(body.resenas.distribucion.length, 5);
    assert.equal(body.actividad.porMes.length, 6);
  });

  test('se recalculan cuando cambian los datos', async () => {
    const get = async () => (await api().get('/api/me/estadisticas').set(ana.auth).expect(200)).body;

    let e = await get();
    assert.equal(e.biblioteca.total, 1);
    assert.equal(e.biblioteca.porcentajeEscuchado, 100);
    assert.equal(e.favoritos, 1);
    assert.equal(e.resenas.promedio, 5);

    await api().put(`/api/me/biblioteca/${c2.id}`).set(ana.auth).send({ estado: 'escuchando' }).expect(200);
    await api().put(`/api/me/resenas/${c2.id}`).set(ana.auth).send({ puntuacion: 3 }).expect(200);

    e = await get();
    assert.equal(e.biblioteca.total, 2);
    assert.deepEqual(e.biblioteca.porEstado, { quiero_escuchar: 0, escuchando: 1, escuchado: 1 });
    assert.equal(e.biblioteca.porcentajeEscuchado, 50);
    assert.equal(e.biblioteca.artistasDistintos, 2);
    assert.equal(e.resenas.promedio, 4);
    assert.deepEqual(e.resenas.distribucion.map((d) => d.cantidad), [0, 0, 1, 0, 1]);
    assert.equal(e.mejorPuntuadas[0].nombre, 'Crimen');
    assert.ok(e.actividad.diasActivosUltimos30 >= 1);
    assert.ok(e.actividad.porMes.at(-1).acciones > 0);
  });
});
