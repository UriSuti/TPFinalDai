import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, cerrar, crearAdmin, crearUsuario, resetDb } from './helpers.js';

let admin, ana, beto, artista, album, cancion1, cancion2;

before(async () => {
  await resetDb();
  admin = await crearAdmin();
  ana = await crearUsuario();
  beto = await crearUsuario();
});
after(cerrar);

describe('catálogo (admin)', () => {
  test('un usuario común no puede escribir el catálogo -> 403', async () => {
    await api().post('/api/artistas').set(ana.auth).send({ nombre: 'X' }).expect(403);
  });

  test('admin crea género, artista, álbum y canciones', async () => {
    const rock = (await api().post('/api/generos').set(admin.auth).send({ nombre: 'Rock nacional' }).expect(201)).body;
    await api().post('/api/generos').set(admin.auth).send({ nombre: 'ROCK NACIONAL' }).expect(409);

    artista = (await api().post('/api/artistas').set(admin.auth).send({ nombre: 'Soda Stereo' }).expect(201)).body;
    await api().put(`/api/artistas/${artista.id}/generos`).set(admin.auth).send({ generoIds: [rock.id] }).expect(204);

    album = (await api().post('/api/albumes').set(admin.auth)
      .send({ nombre: 'Canción Animal', artistaId: artista.id, fechaLanzamiento: '1990-08-07' }).expect(201)).body;

    cancion1 = (await api().post('/api/canciones').set(admin.auth)
      .send({ nombre: 'De música ligera', artistaId: artista.id, albumId: album.id, duracionSegundos: 212 }).expect(201)).body;
    cancion2 = (await api().post('/api/canciones').set(admin.auth)
      .send({ nombre: 'Té para tres', artistaId: artista.id, albumId: album.id }).expect(201)).body;

    assert.equal(cancion1.duracion, 212); // segundos
    assert.equal(cancion2.duracion, null); // duración opcional
    assert.equal(cancion1.album.nombre, 'Canción Animal');
  });

  test('constraints del esquema -> 4xx claros', async () => {
    // FK inexistente
    await api().post('/api/canciones').set(admin.auth).send({ nombre: 'X', artistaId: 9999 }).expect(400);
    // Duplicado (artista, nombre) sin importar mayúsculas
    await api().post('/api/canciones').set(admin.auth).send({ nombre: 'DE MÚSICA LIGERA', artistaId: artista.id }).expect(409);
    // Borrar artista con canciones: RESTRICT
    const r = await api().delete(`/api/artistas/${artista.id}`).set(admin.auth).expect(409);
    assert.match(r.body.error, /No se puede borrar/);
  });

  test('lectura: búsqueda, paginación, filtro por género y detalle', async () => {
    const lista = await api().get('/api/canciones?q=ligera').set(ana.auth).expect(200);
    assert.equal(lista.body.total, 1);
    assert.equal(lista.body.data[0].artista.nombre, 'Soda Stereo');

    const pag = await api().get('/api/canciones?limit=1&page=2').set(ana.auth).expect(200);
    assert.equal(pag.body.data.length, 1);
    assert.equal(pag.body.totalPages, 2);

    await api().get('/api/canciones?limit=500').set(ana.auth).expect(400);
    await api().get('/api/canciones?q=%25').set(ana.auth).expect(200).then((r) => assert.equal(r.body.total, 0));

    const det = await api().get(`/api/artistas/${artista.id}`).set(ana.auth).expect(200);
    assert.equal(det.body.generos[0].nombre, 'Rock nacional');
    assert.equal(det.body.albumes.length, 1);

    const alb = await api().get(`/api/albumes/${album.id}`).set(ana.auth).expect(200);
    assert.equal(alb.body.canciones.length, 2);
    assert.equal(alb.body.duracion, 212); // la canción sin duración no suma

    await api().get('/api/artistas/abc').set(ana.auth).expect(400);
    await api().get('/api/artistas/9999').set(ana.auth).expect(404);
  });

  test('PATCH canción: borrar la duración con null', async () => {
    const r = await api().patch(`/api/canciones/${cancion1.id}`).set(admin.auth).send({ duracionSegundos: null }).expect(200);
    assert.equal(r.body.duracion, null);
    await api().patch(`/api/canciones/${cancion1.id}`).set(admin.auth).send({ duracionSegundos: 212 }).expect(200);
  });
});

describe('playlists', () => {
  let playlist;

  test('crear, listar, agregar canciones y ver duración', async () => {
    playlist = (await api().post('/api/me/playlists').set(ana.auth).send({ nombre: 'Para correr' }).expect(201)).body;
    await api().post(`/api/me/playlists/${playlist.id}/canciones`).set(ana.auth).send({ cancionId: cancion1.id }).expect(201);
    await api().post(`/api/me/playlists/${playlist.id}/canciones`).set(ana.auth).send({ cancionId: cancion1.id }).expect(200);
    await api().post(`/api/me/playlists/${playlist.id}/canciones`).set(ana.auth).send({ cancionId: 9999 }).expect(400);

    const det = await api().get(`/api/me/playlists/${playlist.id}`).set(ana.auth).expect(200);
    assert.equal(det.body.canciones.length, 1);
    assert.equal(det.body.duracion, 212);

    const lista = await api().get('/api/me/playlists').set(ana.auth).expect(200);
    assert.equal(lista.body[0].canciones, 1);
  });

  test('otro usuario no la ve ni la toca (404)', async () => {
    await api().get(`/api/me/playlists/${playlist.id}`).set(beto.auth).expect(404);
    await api().patch(`/api/me/playlists/${playlist.id}`).set(beto.auth).send({ nombre: 'hack' }).expect(404);
    await api().delete(`/api/me/playlists/${playlist.id}`).set(beto.auth).expect(404);
    await api().post(`/api/me/playlists/${playlist.id}/canciones`).set(beto.auth).send({ cancionId: cancion2.id }).expect(404);
  });

  test('un álbum no se puede editar como playlist', async () => {
    await api().get(`/api/me/playlists/${album.id}`).set(ana.auth).expect(404);
    await api().post(`/api/me/playlists/${album.id}/canciones`).set(ana.auth).send({ cancionId: cancion2.id }).expect(404);
  });

  test('renombrar, quitar canción y borrar', async () => {
    await api().patch(`/api/me/playlists/${playlist.id}`).set(ana.auth).send({ nombre: 'Running' }).expect(200);
    await api().delete(`/api/me/playlists/${playlist.id}/canciones/${cancion1.id}`).set(ana.auth).expect(204);
    await api().delete(`/api/me/playlists/${playlist.id}/canciones/${cancion1.id}`).set(ana.auth).expect(404);
    await api().delete(`/api/me/playlists/${playlist.id}`).set(ana.auth).expect(204);
  });
});

describe('favoritos', () => {
  test('PUT idempotente, listado paginado y DELETE', async () => {
    await api().put(`/api/me/favoritos/${cancion1.id}`).set(ana.auth).expect(201);
    await api().put(`/api/me/favoritos/${cancion1.id}`).set(ana.auth).expect(200);
    await api().put('/api/me/favoritos/9999').set(ana.auth).expect(400);

    const l = await api().get('/api/me/favoritos').set(ana.auth).expect(200);
    assert.equal(l.body.total, 1);
    const otro = await api().get('/api/me/favoritos').set(beto.auth).expect(200);
    assert.equal(otro.body.total, 0);

    await api().delete(`/api/me/favoritos/${cancion1.id}`).set(ana.auth).expect(204);
    await api().delete(`/api/me/favoritos/${cancion1.id}`).set(ana.auth).expect(404);
  });
});
