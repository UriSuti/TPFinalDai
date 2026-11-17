// Carga la cuenta de demostración con historia: perfil, biblioteca, favoritos, reseñas,
// playlists, actividad e historial de escucha para el Wrapped.
//
// Uso:  DEMO_PASSWORD=... npm run db:seed            (consulta iTunes para ids y portadas)
//       DEMO_PASSWORD=... npm run db:seed -- --sin-itunes
//
// Es reproducible: si la cuenta ya existe, la borra (en cascada) y la vuelve a crear.
// El historial de escucha es simulado pero determinístico (misma semilla, mismos datos).
// La contraseña nunca está en el repo: sale de DEMO_PASSWORD.
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { pool, withTransaction } from '../src/db.js';
import * as catalogoService from '../src/services/catalogo.js';

const EMAIL = process.env.DEMO_EMAIL || 'demo@mycollection.app';
const PASSWORD = process.env.DEMO_PASSWORD;
const USAR_ITUNES = !process.argv.includes('--sin-itunes');

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Definí DEMO_PASSWORD (mínimo 8 caracteres) en el .env o en la línea de comandos.');
  process.exit(1);
}

// ---------- Datos ----------

const PERFIL = {
  nombre_usuario: 'demo',
  nombre: 'Cami',
  apellido: 'Demo',
  avatar_url: 'https://api.dicebear.com/9.x/thumbs/svg?seed=MyCollectionDemo',
  bio: 'Fan del rock nacional y de todo lo que suene a psicodelia. Armo playlists para cada momento del día.',
  generos_preferidos: ['Rock nacional', 'Rock alternativo', 'Psicodelia'],
  artistas_preferidos: ['Gustavo Cerati', 'Luis Alberto Spinetta', 'Tame Impala'],
};

const GENEROS = {
  'Soda Stereo': ['Rock nacional', 'Pop rock'],
  'Gustavo Cerati': ['Rock nacional', 'Pop rock'],
  'Charly García': ['Rock nacional'],
  'Luis Alberto Spinetta': ['Rock nacional', 'Psicodelia'],
  'Patricio Rey y sus Redonditos de Ricota': ['Rock nacional'],
  'Fito Páez': ['Rock nacional', 'Pop rock'],
  Babasónicos: ['Rock alternativo', 'Pop rock'],
  'Tame Impala': ['Psicodelia', 'Rock alternativo'],
  Radiohead: ['Rock alternativo'],
  'Arctic Monkeys': ['Rock alternativo', 'Indie'],
  'Daft Punk': ['Electrónica'],
  Duki: ['Trap', 'Hip hop'],
  'Nicki Nicole': ['Trap', 'Pop'],
  'Dua Lipa': ['Pop'],
};

// Lo que el usuario guardó. hace: días desde que la agregó a la biblioteca.
// playlists: índices de PLAYLISTS.
const GUARDADAS = [
  { artista: 'Soda Stereo', nombre: 'De Música Ligera', album: 'Canción Animal', hace: 160, estado: 'escuchado', favorito: true, puntuacion: 5, comentario: 'El riff más reconocible del rock en español. No me canso nunca.', playlists: [0] },
  { artista: 'Gustavo Cerati', nombre: 'Crimen', album: 'Ahí Vamos', hace: 150, estado: 'escuchado', favorito: true, puntuacion: 5, comentario: 'La letra es una obra de arte. Ideal para escuchar con auriculares.', playlists: [0, 1] },
  { artista: 'Charly García', nombre: 'Demoliendo Hoteles', album: 'Piano Bar', hace: 140, estado: 'escuchado', puntuacion: 4, playlists: [0] },
  { artista: 'Luis Alberto Spinetta', nombre: 'Seguir Viviendo Sin Tu Amor', album: 'Privé', hace: 132, estado: 'escuchado', favorito: true, puntuacion: 5, comentario: 'Corta, simple y perfecta. Spinetta en estado puro.', playlists: [0] },
  { artista: 'Patricio Rey y sus Redonditos de Ricota', nombre: 'Ji Ji Ji', album: 'Oktubre', hace: 118, estado: 'escuchado', favorito: true, playlists: [0, 2] },
  { artista: 'Fito Páez', nombre: 'Mariposa Tecknicolor', album: 'Circo Beat', hace: 100, estado: 'escuchando', puntuacion: 4, playlists: [0] },
  { artista: 'Tame Impala', nombre: 'Let It Happen', album: 'Currents', hace: 90, estado: 'escuchado', favorito: true, puntuacion: 4, comentario: 'Casi ocho minutos que se pasan volando. Todo Currents vale la pena.', playlists: [1] },
  { artista: 'Radiohead', nombre: 'Karma Police', album: 'OK Computer', hace: 75, estado: 'escuchado', favorito: true, puntuacion: 5, playlists: [1] },
  { artista: 'Arctic Monkeys', nombre: 'Do I Wanna Know?', album: 'AM', hace: 60, estado: 'escuchando', playlists: [1, 2] },
  { artista: 'Daft Punk', nombre: 'Get Lucky', album: 'Random Access Memories', hace: 45, estado: 'escuchado', puntuacion: 3, comentario: 'Buena, pero la pasaron tanto en la radio que me cansó un poco.', playlists: [2] },
  { artista: 'Babasónicos', nombre: 'Irresponsables', album: 'Infame', hace: 30, estado: 'escuchando', playlists: [2] },
  { artista: 'Duki', nombre: "She Don't Give a FO", album: "She Don't Give a FO", hace: 14, estado: 'quiero_escuchar', playlists: [2] },
  { artista: 'Nicki Nicole', nombre: 'Wapo Traketero', album: 'Recuerdos', hace: 9, estado: 'quiero_escuchar' },
  { artista: 'Dua Lipa', nombre: 'Levitating', album: 'Future Nostalgia', hace: 4, estado: 'quiero_escuchar', playlists: [2] },
];

const PLAYLISTS = [
  { nombre: 'Rock nacional de siempre', hace: 155 },
  { nombre: 'Para concentrarme', hace: 88 },
  { nombre: 'Previa del finde', hace: 40 },
];

// Solo para el historial de escucha (no están en la biblioteca). [artista, canción, segundos]
const SOLO_HISTORIAL = [
  ['Soda Stereo', 'Persiana Americana', 290],
  ['Soda Stereo', 'En la Ciudad de la Furia', 346],
  ['Gustavo Cerati', 'Puente', 303],
  ['Gustavo Cerati', 'Adiós', 240],
  ['Charly García', 'Los Dinosaurios', 213],
  ['Luis Alberto Spinetta', 'Muchacha (Ojos de Papel)', 175],
  ['Fito Páez', '11 y 6', 200],
  ['Tame Impala', 'Eventually', 318],
  ['Tame Impala', 'Feels Like We Only Go Backwards', 193],
  ['Radiohead', 'No Surprises', 229],
  ['Arctic Monkeys', '505', 253],
  ['Daft Punk', 'One More Time', 320],
  ['Babasónicos', 'El Colmo', 215],
  ['Duki', 'Goteo', 180],
];

// Cuánto escucha a cada artista (peso relativo en el historial simulado)
const PESO_ARTISTA = {
  'Gustavo Cerati': 10, 'Soda Stereo': 9, 'Tame Impala': 8, 'Luis Alberto Spinetta': 6, Radiohead: 6,
  'Charly García': 5, 'Arctic Monkeys': 5, 'Fito Páez': 4, Babasónicos: 4,
  'Patricio Rey y sus Redonditos de Ricota': 3, 'Daft Punk': 3, Duki: 2, 'Nicki Nicole': 1, 'Dua Lipa': 1,
};

// ---------- Utilidades ----------

// PRNG con semilla: el historial sale igual en cada corrida
function mulberry32(semilla) {
  let a = semilla;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(2026);

function elegirPonderado(items, peso) {
  const total = items.reduce((s, i) => s + peso(i), 0);
  let r = azar() * total;
  for (const item of items) {
    r -= peso(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

const AHORA = new Date();
// Fecha de hace `dias` días, a la hora indicada (hora local del servidor)
function haceDias(dias, hora = 20) {
  const d = new Date(AHORA);
  d.setDate(d.getDate() - dias);
  d.setHours(hora, Math.floor(azar() * 60), 0, 0);
  return d > AHORA ? new Date(AHORA.getTime() - 60_000) : d;
}

const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Busca la canción en iTunes para guardar el mismo id y portada que guardaría el front.
// Prefiere el artista exacto (no colaboraciones) y la versión de estudio (no "Live").
async function buscarEnItunes({ artista, nombre }) {
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: `${artista} ${nombre}`, entity: 'song', limit: '25', country: 'AR' });
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`iTunes respondió ${res.status}`);
  const { results } = await res.json();

  const buscado = sinTildes(nombre);
  const puntaje = (r) => {
    const art = sinTildes(r.artistName);
    const tema = sinTildes(r.trackName);
    if (!art.includes(sinTildes(artista)) || !tema.startsWith(buscado.slice(0, 8))) return -1;
    let p = 0;
    if (art === sinTildes(artista)) p += 4;
    if (tema === buscado) p += 3;
    if (/live|en vivo|directo|acustico|unplugged|remix/.test(tema)) p -= 3;
    return p;
  };
  const mejor = results.map((r) => ({ r, p: puntaje(r) })).filter((x) => x.p >= 0).sort((a, b) => b.p - a.p)[0];
  return mejor?.r ?? null;
}

// ---------- Carga ----------

// Se resuelve todo el catálogo ANTES de abrir la transacción de la cuenta: resolverCancion usa
// su propia conexión y, si se llamara adentro, esperaría los locks que tiene la transacción.
async function resolverGuardadas() {
  const alias = {}; // nombre de artista nuestro -> nombre en iTunes (ej. "Fito Páez" -> "Fito Paez")
  for (const [i, g] of GUARDADAS.entries()) {
    let datos = { nombre: g.nombre, artista: g.artista, album: g.album };
    if (USAR_ITUNES) {
      try {
        const r = await buscarEnItunes(g);
        if (r) {
          // Si iTunes lo acredita a una colaboración ("Duki & KHEA"), se mantiene nuestro artista
          // para no partir sus géneros y su historial en dos.
          const mismoArtista = sinTildes(r.artistName) === sinTildes(g.artista);
          datos = {
            nombre: mismoArtista ? r.trackName : g.nombre,
            artista: mismoArtista ? r.artistName : g.artista,
            album: r.collectionName ?? g.album,
            duracionSegundos: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
            itunesId: r.trackId,
            portadaUrl: r.artworkUrl100?.replace('100x100bb', '600x600bb'),
          };
          if (mismoArtista) alias[g.artista] = r.artistName;
        } else {
          console.warn(`  iTunes no encontró "${g.nombre}" de ${g.artista}: se guarda sin portada`);
        }
      } catch (err) {
        console.warn(`  iTunes falló para "${g.nombre}" (${err.message}): se guarda sin portada`);
      }
      // iTunes limita a ~20 consultas por minuto
      if (i < GUARDADAS.length - 1) await dormir(3200);
    }
    const cancion = await catalogoService.resolverCancion(datos);
    g.id = cancion.id;
    g.duracion = cancion.duracion ?? datos.duracionSegundos ?? 210;
    process.stdout.write(`  ${i + 1}/${GUARDADAS.length} ${datos.artista} - ${datos.nombre}\n`);
  }
  return alias;
}

async function cargarGeneros(db, alias) {
  for (const [artista, generos] of Object.entries(GENEROS)) {
    const nombre = alias[artista] ?? artista;
    await db.query(
      `INSERT INTO public.artistas (nombre) VALUES ($1) ON CONFLICT ((lower(nombre))) DO NOTHING`,
      [nombre],
    );
    for (const genero of generos) {
      await db.query('INSERT INTO public.generos (nombre) VALUES ($1) ON CONFLICT ((lower(nombre))) DO NOTHING', [genero]);
      await db.query(
        `INSERT INTO public.artistas_generos (artista_id, genero_id)
         SELECT a.id, g.id FROM public.artistas a, public.generos g
          WHERE lower(a.nombre) = lower($1) AND lower(g.nombre) = lower($2)
         ON CONFLICT DO NOTHING`,
        [nombre, genero],
      );
    }
    // Ya tiene géneros: "Completar géneros" con Last.fm no lo vuelve a consultar
    await db.query(
      'UPDATE public.artistas SET generos_sincronizados_en = now() WHERE lower(nombre) = lower($1)',
      [nombre],
    );
  }
}

async function crearUsuario(db) {
  await db.query(
    'DELETE FROM public.usuarios WHERE lower(email) = lower($1) OR lower(nombre_usuario) = $2',
    [EMAIL, PERFIL.nombre_usuario],
  );
  const hash = await bcrypt.hash(PASSWORD, config.BCRYPT_ROUNDS);
  const { rows } = await db.query(
    `INSERT INTO public.usuarios (nombre_usuario, nombre, apellido, email, password_hash, avatar_url, bio,
                                  generos_preferidos, artistas_preferidos, fecha_registro)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING id`,
    [PERFIL.nombre_usuario, PERFIL.nombre, PERFIL.apellido, EMAIL, hash, PERFIL.avatar_url, PERFIL.bio,
      JSON.stringify(PERFIL.generos_preferidos), JSON.stringify(PERFIL.artistas_preferidos), haceDias(170, 18)],
  );
  return rows[0].id;
}

async function cargarBiblioteca(db, usuarioId) {
  const actividad = (tipo, fecha, { cancion, playlistId = null, detalle = {} } = {}) => db.query(
    `INSERT INTO public.actividad (usuario_id, tipo, cancion_id, playlist_id, detalle, fecha)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [usuarioId, tipo, cancion?.id ?? null, playlistId,
      JSON.stringify(cancion ? { cancion: cancion.nombre, artista: cancion.artista, ...detalle } : detalle), fecha],
  );

  // Playlists
  const playlistIds = [];
  for (const p of PLAYLISTS) {
    const fecha = haceDias(p.hace, 21);
    const { rows } = await db.query(
      'INSERT INTO public.playlists (nombre, usuario_id, fecha_creacion) VALUES ($1, $2, $3) RETURNING id',
      [p.nombre, usuarioId, fecha],
    );
    playlistIds.push(rows[0].id);
    await actividad('playlist_crear', fecha, { playlistId: rows[0].id, detalle: { playlist: p.nombre } });
  }

  for (const g of GUARDADAS) {
    // Pasos del estado: se agrega como "quiero escuchar" y avanza con los días
    const pasos = [{ estado: 'quiero_escuchar', fecha: haceDias(g.hace, 19) }];
    if (g.estado !== 'quiero_escuchar') pasos.push({ estado: 'escuchando', fecha: haceDias(g.hace - 2, 22) });
    if (g.estado === 'escuchado') pasos.push({ estado: 'escuchado', fecha: haceDias(g.hace - 6, 23) });
    const ultimo = pasos[pasos.length - 1];

    await db.query(
      `INSERT INTO public.biblioteca (usuario_id, cancion_id, estado, fecha_agregada, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5)`,
      [usuarioId, g.id, g.estado, pasos[0].fecha, ultimo.fecha],
    );
    await actividad('biblioteca_agregar', pasos[0].fecha, { cancion: g, detalle: { estado: pasos[0].estado, anterior: null } });
    for (let i = 1; i < pasos.length; i++) {
      await actividad('biblioteca_estado', pasos[i].fecha, {
        cancion: g, detalle: { estado: pasos[i].estado, anterior: pasos[i - 1].estado },
      });
    }

    if (g.favorito) {
      const fecha = haceDias(g.hace - 7, 13);
      await db.query(
        'INSERT INTO public.favoritos (usuario_id, cancion_id, fecha_agregada) VALUES ($1, $2, $3)',
        [usuarioId, g.id, fecha],
      );
      await actividad('favorito_agregar', fecha, { cancion: g });
    }

    if (g.puntuacion || g.comentario) {
      const fecha = haceDias(g.hace - 8, 14);
      await db.query(
        `INSERT INTO public.resenas (usuario_id, cancion_id, puntuacion, comentario, fecha_creacion, fecha_actualizacion)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [usuarioId, g.id, g.puntuacion ?? null, g.comentario ?? null, fecha],
      );
      await actividad('resena_crear', fecha, {
        cancion: g, detalle: { puntuacion: g.puntuacion ?? null, conComentario: Boolean(g.comentario) },
      });
    }

    for (const i of g.playlists ?? []) {
      // Se agrega a la playlist después de que existan las dos
      const fecha = haceDias(Math.min(g.hace, PLAYLISTS[i].hace) - 1, 17);
      await db.query(
        'INSERT INTO public.canciones_playlists (playlist_id, cancion_id, fecha_agregada) VALUES ($1, $2, $3)',
        [playlistIds[i], g.id, fecha],
      );
      await actividad('playlist_agregar_cancion', fecha, {
        cancion: g, playlistId: playlistIds[i], detalle: { playlist: PLAYLISTS[i].nombre },
      });
    }
  }
}

async function resolverSoloHistorial(alias) {
  const canciones = [];
  for (const [artista, nombre, segundos] of SOLO_HISTORIAL) {
    const c = await catalogoService.resolverCancion({ nombre, artista: alias[artista] ?? artista, duracionSegundos: segundos });
    canciones.push({ id: c.id, artista, segundos });
  }
  return canciones;
}

// Historial de escucha simulado: el año anterior completo y el actual hasta hoy.
async function cargarHistorial(db, usuarioId, soloHistorial) {
  const canciones = [...GUARDADAS.map((g) => ({ id: g.id, artista: g.artista, segundos: g.duracion })), ...soloHistorial];

  // Horarios: poco de madrugada, picos a la mañana, después de comer y a la noche
  const PESO_HORA = [1, 0.5, 0.2, 0.1, 0.1, 0.2, 1, 3, 5, 4, 3, 3, 3, 5, 4, 3, 3, 4, 6, 7, 8, 8, 6, 3];
  const horas = [...Array(24).keys()];

  const filas = { cancion: [], fecha: [], ms: [], salteada: [], plataforma: [] };
  const anioActual = AHORA.getFullYear();
  for (const [anio, cantidad] of [[anioActual - 1, 1400], [anioActual, 1250]]) {
    const inicio = new Date(anio, 0, 1).getTime();
    const fin = Math.min(new Date(anio + 1, 0, 1).getTime(), AHORA.getTime());
    for (let i = 0; i < cantidad; i++) {
      const c = elegirPonderado(canciones, (x) => PESO_ARTISTA[x.artista] ?? 1);
      const dia = new Date(inicio + azar() * (fin - inicio));
      dia.setHours(elegirPonderado(horas, (h) => PESO_HORA[h]), Math.floor(azar() * 60), Math.floor(azar() * 60), 0);
      if (dia > AHORA) continue;
      const salteada = azar() < 0.12;
      filas.cancion.push(c.id);
      filas.fecha.push(dia.toISOString());
      filas.ms.push(salteada ? Math.floor(5000 + azar() * 20000) : c.segundos * 1000);
      filas.salteada.push(salteada);
      filas.plataforma.push(azar() < 0.7 ? 'android' : 'web');
    }
  }

  const { rowCount } = await db.query(
    `INSERT INTO public.reproducciones (usuario_id, cancion_id, fuente, fecha_hora, ms_reproducidos, salteada, plataforma)
     SELECT $1, c, 'manual', f, m, s, p
       FROM unnest($2::int[], $3::timestamptz[], $4::int[], $5::bool[], $6::text[]) AS x(c, f, m, s, p)
     ON CONFLICT DO NOTHING`,
    [usuarioId, filas.cancion, filas.fecha, filas.ms, filas.salteada, filas.plataforma],
  );
  return rowCount;
}

try {
  console.log(`Cuenta demo: ${EMAIL}`);
  console.log(USAR_ITUNES ? 'Buscando las canciones en iTunes (tarda ~1 minuto)...' : 'Sin iTunes: las canciones no van a tener portada');
  const alias = await resolverGuardadas();
  const soloHistorial = await resolverSoloHistorial(alias);

  const resumen = await withTransaction(async (db) => {
    await cargarGeneros(db, alias);
    const usuarioId = await crearUsuario(db);
    await cargarBiblioteca(db, usuarioId);
    const reproducciones = await cargarHistorial(db, usuarioId, soloHistorial);
    return { usuarioId, reproducciones };
  });

  await pool.query('ANALYZE');
  console.log(`Listo: usuario ${resumen.usuarioId}, ${GUARDADAS.length} canciones en la biblioteca, `
    + `${PLAYLISTS.length} playlists y ${resumen.reproducciones} reproducciones.`);
} catch (err) {
  console.error('No se pudo cargar la demo:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
