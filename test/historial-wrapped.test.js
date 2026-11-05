import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, cerrar, crearUsuario, lastfm, pool, resetDb } from './helpers.js';
import { tagsAGeneros } from '../src/services/generos.js';

let ana, beto;

before(async () => {
  await resetDb();
  ana = await crearUsuario();
  beto = await crearUsuario();
});
after(cerrar);

// Fila del "Extended streaming history" (solo los campos que usamos + ruido)
const ext = (ts, artista, cancion, ms, extra = {}) => ({
  ts,
  username: 'x',
  platform: 'android',
  ms_played: ms,
  conn_country: 'AR',
  master_metadata_track_name: cancion,
  master_metadata_album_artist_name: artista,
  master_metadata_album_album_name: extra.album ?? 'Álbum de prueba',
  spotify_track_uri: `spotify:track:${cancion.replace(/\W/g, '')}`,
  episode_name: null,
  shuffle: extra.shuffle ?? false,
  skipped: extra.skipped ?? false,
});

const extendido = [
  ext('2026-03-02T15:00:00Z', 'Duki', 'Goteo', 180000),
  ext('2026-03-02T15:05:00Z', 'DUKI', 'goteo', 180000),               // mismo artista/canción en otras mayúsculas
  ext('2026-03-02T15:10:00Z', 'Duki', 'Goteo', 5000, { skipped: true }), // < 30 s: no cuenta como stream
  ext('2026-03-03T01:30:00Z', 'Soda Stereo', 'Persiana Americana', 290000, { album: 'Signos' }), // 22:30 del 2/3 en BA
  ext('2026-01-01T02:00:00Z', 'Soda Stereo', 'Persiana Americana', 290000, { album: 'Signos' }), // 23:00 del 31/12/2025 en BA
  { ts: '2026-03-04T10:00:00Z', ms_played: 1800000, master_metadata_track_name: null, episode_name: 'Un podcast' }, // podcast
  { ts: 'fecha-rota', master_metadata_track_name: 'X', master_metadata_album_artist_name: 'Y', ms_played: 1 },
];

// Export "Account data": endTime en UTC, sin álbum ni URI
const basico = [
  { endTime: '2026-03-05 23:00', artistName: 'Cerati', trackName: 'Crimen', msPlayed: 230000 },
];

const archivo = (datos) => Buffer.from(JSON.stringify(datos));

describe('importación de Spotify', () => {
  test('sin archivos o con archivos inválidos -> 400', async () => {
    await api().post('/api/me/importaciones/spotify').set(ana.auth).expect(400);
    await api().post('/api/me/importaciones/spotify').set(ana.auth)
      .attach('archivos', Buffer.from('{no es json'), 'roto.json').expect(400);
    await api().post('/api/me/importaciones/spotify').set(ana.auth)
      .attach('archivos', Buffer.from('hola'), 'notas.txt').expect(400);
    await api().post('/api/me/importaciones/spotify').set(ana.auth)
      .attach('archivos', archivo({ a: 1 }), 'objeto.json').expect(400);
  });

  test('importa los dos formatos, descarta podcasts y filas rotas, unifica mayúsculas', async () => {
    const res = await api().post('/api/me/importaciones/spotify').set(ana.auth)
      .attach('archivos', archivo(extendido), 'Streaming_History_Audio_2026.json')
      .attach('archivos', archivo(basico), 'StreamingHistory_music_0.json')
      .expect(201);

    const [a, b] = res.body;
    assert.deepEqual([a.filas_leidas, a.filas_insertadas, a.filas_descartadas], [7, 5, 2]);
    assert.deepEqual([b.filas_leidas, b.filas_insertadas], [1, 1]);

    const { rows: [conteo] } = await pool.query(`
      SELECT (SELECT count(*) FROM public.artistas) AS artistas,
             (SELECT count(*) FROM public.canciones) AS canciones,
             (SELECT count(*) FROM public.playlists WHERE es_album) AS albumes`);
    assert.deepEqual(conteo, { artistas: 3, canciones: 3, albumes: 2 }); // Duki/DUKI es uno solo
  });

  test('subir el mismo archivo de nuevo no duplica', async () => {
    const res = await api().post('/api/me/importaciones/spotify').set(ana.auth)
      .attach('archivos', archivo(extendido), 'Streaming_History_Audio_2026.json').expect(201);
    assert.equal(res.body[0].filas_insertadas, 0);
    assert.equal(res.body[0].filas_duplicadas, 5);
  });

  test('historial paginado y filtrado por fecha, aislado por usuario', async () => {
    const todo = await api().get('/api/me/reproducciones').set(ana.auth).expect(200);
    assert.equal(todo.body.total, 6);
    const marzo5 = await api().get('/api/me/reproducciones?desde=2026-03-05T00:00:00Z').set(ana.auth).expect(200);
    assert.equal(marzo5.body.total, 1);
    assert.equal(marzo5.body.data[0].artista, 'Cerati');
    const deBeto = await api().get('/api/me/reproducciones').set(beto.auth).expect(200);
    assert.equal(deBeto.body.total, 0);
  });
});

describe('wrapped', () => {
  test('años disponibles respetan la zona horaria de Buenos Aires', async () => {
    const res = await api().get('/api/me/wrapped').set(ana.auth).expect(200);
    assert.deepEqual(res.body.map((r) => r.anio), [2026, 2025]);
  });

  test('resumen, tops y hábitos de 2026', async () => {
    const { body: w } = await api().get('/api/me/wrapped/2026').set(ana.auth).expect(200);

    // 180000*2 + 5000 + 290000 + 230000 = 885000 ms = 14,75 min
    assert.equal(w.resumen.minutos_escuchados, 15);
    assert.equal(w.resumen.streams, 4); // el de 5 s no cuenta
    assert.equal(w.resumen.artistas_distintos, 3);
    assert.equal(w.minutosEstimados, false);

    assert.equal(w.topCanciones[0].cancion, 'Goteo');
    assert.equal(w.topCanciones[0].streams, 2);
    assert.equal(w.topArtistas[0].artista, 'Duki'); // 6 min vs 4,8 de Soda
    assert.equal(w.topArtistas[0].minutos, 6);
    assert.deepEqual(w.topGeneros, []); // todavía no se sincronizaron géneros

    assert.equal(w.porMes[2].mes, 3);
    assert.equal(w.porMes[2].streams, 4);
    // 15:00 UTC = 12:00 en BA (lunes 2/3/2026)
    assert.equal(w.habitos.horaFavorita, 12);
    assert.equal(w.habitos.diaFavorito, 'lunes');
    assert.equal(w.habitos.salteadas, 1);
    assert.equal(w.habitos.porDia.length, 7);
  });

  test('endpoints de detalle y errores', async () => {
    const top = await api().get('/api/me/wrapped/2026/canciones?limit=1').set(ana.auth).expect(200);
    assert.equal(top.body.length, 1);
    assert.equal(top.body[0].usuario_id, undefined);
    const h = await api().get('/api/me/wrapped/2026/habitos').set(ana.auth).expect(200);
    assert.equal(h.body.porHora.length, 24);
    await api().get('/api/me/wrapped/2019').set(ana.auth).expect(404);
    await api().get('/api/me/wrapped/abc').set(ana.auth).expect(400);
    await api().get('/api/me/wrapped/2026').set(beto.auth).expect(404); // beto no tiene datos
  });
});

describe('Last.fm', () => {
  // uts: 2026-06-01 en adelante, de a 1 hora. La API real los devuelve del más nuevo al más viejo.
  const base = Date.UTC(2026, 5, 1) / 1000;
  const scrobble = (i, artista, cancion) => ({ uts: base + i * 3600, artista, cancion, album: 'Disco' });

  test('usuario de Last.fm inexistente -> 404; sin usuario -> 400', async () => {
    await api().post('/api/me/importaciones/lastfm').set(beto.auth).send({}).expect(400);
    await api().post('/api/me/importaciones/lastfm').set(beto.auth).send({ usuario: 'noexiste' }).expect(404);
  });

  test('sincroniza, guarda el usuario en el perfil y la segunda vez es incremental', async () => {
    lastfm.scrobbles = [
      scrobble(2, 'Wos', 'Canguro'),
      scrobble(1, 'Wos', 'Canguro'),
      scrobble(0, 'Duki', 'Goteo'), // ya existe en el catálogo por el import de Spotify
    ];
    const r1 = await api().post('/api/me/importaciones/lastfm').set(beto.auth).send({ usuario: 'beto_fm' }).expect(201);
    assert.equal(r1.body.filas_insertadas, 3);
    assert.equal(r1.body.completo, true);

    const me = await api().get('/api/me').set(beto.auth).expect(200);
    assert.equal(me.body.lastfm_usuario, 'beto_fm');

    lastfm.scrobbles.unshift(scrobble(3, 'Wos', 'Alma dinamita'));
    lastfm.llamadas = [];
    const r2 = await api().post('/api/me/importaciones/lastfm').set(beto.auth).send({}).expect(201);
    assert.equal(r2.body.filas_insertadas, 1);
    assert.equal(Number(lastfm.llamadas[0].from), base + 2 * 3600 + 1); // pidió solo lo nuevo

    const { rows } = await pool.query("SELECT count(*) AS n FROM public.artistas WHERE lower(nombre) = 'duki'");
    assert.equal(rows[0].n, 1);
  });

  test('wrapped con datos de Last.fm marca los minutos como estimados', async () => {
    const { body: w } = await api().get('/api/me/wrapped/2026').set(beto.auth).expect(200);
    assert.equal(w.resumen.streams, 4);
    assert.equal(w.minutosEstimados, true);
    assert.equal(w.resumen.minutos_escuchados, 14); // 4 x 3:30 estimado
    assert.equal(w.topArtistas[0].artista, 'Wos');
  });

  test('sincronización paginada: recorre de lo más viejo a lo más nuevo', async () => {
    const carlos = await crearUsuario();
    lastfm.scrobbles = Array.from({ length: 450 }, (_, i) => scrobble(1000 + i, 'Nathy Peluso', `Tema ${i}`)).reverse();
    lastfm.llamadas = [];
    const r = await api().post('/api/me/importaciones/lastfm').set(carlos.auth).send({ usuario: 'carlos' }).expect(201);
    assert.equal(r.body.filas_insertadas, 450);
    assert.deepEqual(lastfm.llamadas.map((l) => l.page), ['1', '3', '2']);
    assert.ok(lastfm.llamadas.every((l) => l.to === lastfm.llamadas[0].to)); // ventana fija
  });

  test('géneros desde tags de Last.fm, filtrando los que no son géneros', async () => {
    assert.deepEqual(
      tagsAGeneros([
        { nombre: 'Trap', peso: 100 }, { nombre: 'seen live', peso: 90 }, { nombre: 'argentina', peso: 80 },
        { nombre: 'Hip-Hop', peso: 70 }, { nombre: '2010s', peso: 60 }, { nombre: 'rap', peso: 50 },
        { nombre: 'latin', peso: 45 }, { nombre: 'raro', peso: 5 },
      ]),
      ['trap', 'hip-hop', 'rap'],
    );

    lastfm.tags = {
      Wos: [{ name: 'Rap', count: '100' }, { name: 'Hip-Hop', count: '60' }, { name: 'seen live', count: '50' }],
      Duki: [{ name: 'Trap', count: '100' }, { name: 'rap', count: '80' }],
    };
    const r = await api().post('/api/generos/sincronizar').set(beto.auth).send({}).expect(200);
    assert.equal(r.body.procesados, 2); // solo artistas que escuchó beto
    assert.equal(r.body.conGeneros, 2);

    const { body: w } = await api().get('/api/me/wrapped/2026').set(beto.auth).expect(200);
    assert.equal(w.topGeneros[0].genero, 'rap');     // Wos (3) + Duki (1)
    assert.equal(w.topGeneros[0].streams, 4);
    assert.equal(w.topGeneros[0].porcentaje, 100);

    // Ya sincronizados: no se vuelven a pedir
    lastfm.llamadas = [];
    await api().post('/api/generos/sincronizar').set(beto.auth).send({}).expect(200);
    assert.equal(lastfm.llamadas.length, 0);
  });
});

describe('deshacer y carga manual', () => {
  test('borrar una importación borra sus reproducciones', async () => {
    const { body: imps } = await api().get('/api/me/importaciones').set(ana.auth).expect(200);
    const basicoImp = imps.find((i) => i.detalle === 'StreamingHistory_music_0.json');
    await api().delete(`/api/me/importaciones/${basicoImp.id}`).set(beto.auth).expect(404); // no es de beto
    await api().delete(`/api/me/importaciones/${basicoImp.id}`).set(ana.auth).expect(204);
    const res = await api().get('/api/me/reproducciones').set(ana.auth).expect(200);
    assert.equal(res.body.total, 5);
  });

  test('POST /me/reproducciones manual y DELETE', async () => {
    const { rows: [c] } = await pool.query("SELECT id FROM public.canciones WHERE nombre = 'Goteo'");
    const r = await api().post('/api/me/reproducciones').set(ana.auth)
      .send({ cancionId: c.id, fechaHora: '2026-07-01T20:00:00-03:00', msReproducidos: 100000 }).expect(201);
    assert.equal(r.body.fuente, 'manual');
    await api().post('/api/me/reproducciones').set(ana.auth).send({ cancionId: 9999 }).expect(400);
    await api().delete(`/api/me/reproducciones/${r.body.id}`).set(beto.auth).expect(404);
    await api().delete(`/api/me/reproducciones/${r.body.id}`).set(ana.auth).expect(204);
  });

  test('no se puede borrar una canción con historial (RESTRICT)', async () => {
    const admin = await crearUsuario();
    await pool.query("UPDATE public.usuarios SET rol = 'admin' WHERE id = $1", [admin.usuario.id]);
    const login = await api().post('/api/auth/login').send({ email: admin.usuario.email, password: admin.password });
    const { rows: [c] } = await pool.query("SELECT id FROM public.canciones WHERE nombre = 'Goteo'");
    await api().delete(`/api/canciones/${c.id}`).set('Authorization', `Bearer ${login.body.accessToken}`).expect(409);
  });
});
