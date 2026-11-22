# My collection — Backend

Este es el backend de **My collection**, una app de música que permite revisar los hábitos de escucha y armar una biblioteca personal.

Con el historial del usuario genera un resumen anual al estilo Wrapped: muestra las canciones y artistas más escuchados, los géneros principales y algunos datos sobre cuándo escucha música. También permite guardar canciones, marcarlas como favoritas, escribir reseñas y crear playlists.

Está hecho con **Node.js, Express 5 y PostgreSQL**. Spotify se usa como referencia para importar el historial, pero la aplicación no utiliza su marca.

Proyecto final de EFSI y DAI (2026).

## Enlaces del proyecto

| Qué | Dónde |
|---|---|
| Backend desplegado | https://tpfinaldai-9fzc.onrender.com (probar con `/api/health`) |
| Front (repositorio) | https://github.com/tomigrins/Spotify-Front |
| Front desplegado | (https://spotify-tp-final.vercel.app) |
| Documentación de endpoints | [docs/API.md](docs/API.md) |
| Trello | [Tablero](https://trello.com/invite/b/6ae1ee5d1a0ace8d69167ae2/ATTI9cce4d56107b846ae0bb8ee2dd53a6748CC5A74B/tpfinal-diaefsi) |
| Figma | [Diseño](https://www.figma.com/design/2NoD0EsCJS2yQB8j9D6tWj/Untitled?node-id=0-1&t=jbcXbBtEcEyxmJ3B-1) |

> **A tener en cuenta:** el backend está alojado en el plan gratuito de Render. Si pasa un tiempo sin recibir requests, puede tardar unos 50 segundos en responder la primera vez.

## Integrantes

| Integrante | Responsabilidades |
|---|---|
| Uriel Suti | Integración del front con el backend, aplicación del diseño de Figma, actividad y estadísticas de la biblioteca |
| Tomás Grinstein (`tomigrins`) | Base del front y consumo de la API externa (iTunes), pantalla de detalle, diseño responsive y deploy del front en Vercel |
| Nicolás Cukier | Base de datos en Neon, despliegue del backend en Render, documentación de la API y tests del backend (autorización y rate limit) |

## Arquitectura general

```
Navegador ──> Front (React + Vite, Vercel) ──/api/*──> Backend (Express, Render) ──> PostgreSQL (Neon)
     │              rewrite de vercel.json                     │
     └──> iTunes Search API (catálogo)                         └──> Last.fm API (scrobbles y géneros)
```

- El **front** es una SPA. Busca canciones, álbumes y artistas directamente en la iTunes Search API y
  todo lo del usuario (sesión, biblioteca, reseñas, playlists, Wrapped) lo pide al backend.
- En producción el front llama a `/api` en su propio dominio y Vercel reenvía esas requests a Render,
  así la cookie de sesión es del mismo sitio que el front.
- El **backend** es una API REST en capas (controllers → services → repositories, ver
  [Cómo está organizado el backend](#cómo-está-organizado-el-backend)) sobre PostgreSQL.

## Cómo levantar el proyecto

```bash
npm install
cp .env.example .env               # completar DATABASE_URL y JWT_SECRET
createdb spotify_wrapped
npm run db:init                     # carga db/schema.sql (no necesita psql)
npm run db:seed                     # (opcional) cuenta demo con datos, ver más abajo
npm run dev                         # http://localhost:3000
npm run admin -- tu@mail.com        # (opcional) darle rol admin a un usuario ya registrado
```

`npm run db:init` está pensado para una base vacía. Si ya tiene tablas, va a fallar. Para empezar de cero se puede usar:

`npm run db:init -- --reset`

**Ojo:** esto elimina todo el esquema `public` de esa base.

### Datos para probar

`npm run db:seed` carga una cuenta de ejemplo para probar el frontend sin tener que importar un historial propio. Incluye un perfil, 14 canciones con distintos estados, favoritos, reseñas, 3 playlists y su actividad. También agrega unas 2.600 reproducciones simuladas, repartidas entre el año anterior y el actual, para que el Wrapped tenga datos.

- Credenciales: `DEMO_EMAIL` (por defecto `demo@mycollection.app`) y `DEMO_PASSWORD` (mínimo 8
  caracteres, obligatoria), del `.env`.
- Consulta iTunes para guardar `itunes_id` y portada de cada canción (tarda ~1 minuto por el rate
  limit). Sin conexión: `npm run db:seed -- --sin-itunes`.
- Es reproducible: si la cuenta ya existe, la borra y la vuelve a crear. El historial usa una
  semilla fija, así que sale igual en cada corrida.
- Carga los géneros de sus artistas a mano: no hace falta `LASTFM_API_KEY`.

Tests de integración (79, contra un PostgreSQL real y un Last.fm falso local):

```bash
createdb spotify_wrapped_test
npm test                            # usa TEST_DATABASE_URL o postgres://postgres@localhost:5432/spotify_wrapped_test
```

**Los tests borran y recrean el esquema `public` de la base que se les indique.** Apuntarlos
siempre a una base de test, nunca a la de desarrollo ni a la de producción.

Requiere Node 20+ y PostgreSQL 12+.

### Configuración

Se leen del `.env` (hay un modelo en `.env.example`) y se validan al arrancar en `src/config.js`.

| Variable | Obligatoria | Por defecto | Para qué sirve |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development`, `test` o `production`. En producción la cookie va `Secure` y los errores 500 no muestran detalle |
| `PORT` | No | `3000` | Puerto del servidor |
| `DATABASE_URL` | **Sí** | — | Conexión a PostgreSQL |
| `JWT_SECRET` | **Sí** | — | Clave de firma de los JWT, mínimo 32 caracteres |
| `JWT_ACCESS_TTL` | No | `2h` | Duración del JWT y de la sesión del navegador |
| `COOKIE_SAMESITE` | No | `strict` | `strict`, `lax` o `none` (con front y back en dominios distintos: `none`, fuerza `Secure`) |
| `REFRESH_TTL_DIAS` | No | `7` | Vida del refresh token (solo con `?modo=tokens`) |
| `BCRYPT_ROUNDS` | No | `12` | Costo del hash de contraseñas, de 4 a 15 |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Orígenes permitidos del front, separados por coma |
| `LASTFM_API_KEY` | No | vacío | Habilita Last.fm y los géneros |
| `LASTFM_BASE_URL` | No | `https://ws.audioscrobbler.com/2.0/` | Solo se cambia en los tests |
| `MAX_UPLOAD_MB` | No | `20` | Tamaño máximo de cada `.json` de Spotify |
| `DEMO_EMAIL` | No | `demo@mycollection.app` | Email de la cuenta demo (solo `db:seed`) |
| `DEMO_PASSWORD` | Para el seed | — | Contraseña de la cuenta demo, mínimo 8 caracteres (solo `db:seed`) |
| `TEST_DATABASE_URL` | No | `postgres://postgres@localhost:5432/spotify_wrapped_test` | Base que usa `npm test` |

### Dónde está alojado

- **Base de datos:** PostgreSQL en Neon, con conexión directa (sin pooling), porque el esquema
  usa `SET search_path` de sesión. El esquema se cargó con `npm run db:init`.
- **Backend:** Render (Web Service, Node), conectado a la rama `main`. Build: `npm install`.
  Start: `npm start`. Cada merge a `main` redeploya solo.
- **Variables en Render:** `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SAMESITE=none`
  y `CORS_ORIGIN` con la URL del front.
- **Cómo llega el front:** no llama directo a Render. Pide `/api/*` a su propio dominio de Vercel y
  `vercel.json` reenvía esas requests al backend. Para el navegador, front y back son el mismo sitio:
  la cookie de sesión es propia del dominio del front (no la bloquean los navegadores que descartan
  cookies de terceros) y CORS no interviene. `COOKIE_SAMESITE=none` y `CORS_ORIGIN` quedan
  configuradas solo para el caso de que un front llame directamente a la URL de Render.
- Las credenciales de producción **no están en el repositorio**: solo existen como variables de
  entorno en el hosting.
- `GET /api/health` responde `{ "ok": true }` y consulta la base.

---

## APIs externas y de dónde salen los datos

| Fuente | Qué da | Problema | Decisión |
|---|---|---|---|
| **Export de Spotify** (Privacidad → Descargar tus datos) | Historial completo: fecha, canción, artista, álbum, ms escuchados, shuffle, salteada | Tarda días (extendido: hasta 30). No trae géneros ni duración de la canción | **Fuente principal.** Se sube el JSON |
| **Last.fm API** | Scrobbles con fecha (todo el historial) + tags por artista | No trae cuánto se escuchó; los tags son texto libre | **Fuente alternativa y para los géneros.** Solo API key gratis, sin OAuth |
| **iTunes Search API** (`/search`, `/lookup`, sin API key) | Catálogo con portadas, álbumes y artistas | Sin historial de escucha | **La usa el front para explorar.** El backend solo guarda `itunes_id` y `portada_url` vía `POST /api/canciones/resolver` |
| **Spotify Web API** | Metadata, top items, últimas 50 escuchas | Desde feb-2026 en modo desarrollo: el dueño de la app necesita Premium, máximo 5 usuarios, sin endpoints por lotes y búsqueda limitada a 10 resultados. "Recently played" solo trae 50 escuchas, no sirve para un resumen anual | **No se usa** |

En la práctica, usamos el **export de Spotify** como fuente principal del Wrapped. También se puede importar el historial de **Last.fm**, si el usuario lo tiene. Last.fm se usa además para buscar los géneros de los artistas (`artist.getTopTags`).

Si no se configura `LASTFM_API_KEY`, la importación de Spotify sigue funcionando; lo único que queda desactivado es la integración con Last.fm y la sincronización de géneros.

---

## Base de datos (modelo de datos)

| Tabla | Qué guarda | Campos principales |
|---|---|---|
| `usuarios` | Cuentas | `id`, `nombre_usuario` (único), `nombre`, `apellido`, `email` (único), `password_hash`, `rol`, `lastfm_usuario`, `avatar_url`, `bio`, `generos_preferidos`, `artistas_preferidos` |
| `refresh_tokens` | Sesiones de clientes `?modo=tokens` | `usuario_id`, `token_hash` (SHA-256), `expira_en`, `revocado_en` |
| `artistas` | Catálogo | `id`, `nombre`, `generos_sincronizados_en` |
| `generos` / `artistas_generos` | Géneros (N a N con artistas) | `nombre` / `artista_id`, `genero_id` |
| `playlists` | Playlists del usuario (`es_album=false`) y álbumes (`es_album=true`) | `nombre`, `usuario_id` o `artista_id`, `fecha_lanzamiento` |
| `canciones` | Catálogo | `nombre`, `artista_id`, `album_id`, `duracion`, `spotify_uri`, `itunes_id`, `portada_url` |
| `canciones_playlists` | Canciones de cada playlist | `playlist_id`, `cancion_id`, `fecha_agregada` |
| `biblioteca` | Estado de cada canción para el usuario | `usuario_id`, `cancion_id`, `estado` |
| `favoritos` | Canciones favoritas | `usuario_id`, `cancion_id` |
| `resenas` | Puntuación y comentario | `usuario_id`, `cancion_id`, `puntuacion` (1 a 5), `comentario` |
| `importaciones` | Cada archivo o sincronización importada | `usuario_id`, `fuente`, `filas_leidas` / `insertadas` / `descartadas` |
| `reproducciones` | Historial de escucha (base del Wrapped) | `usuario_id`, `cancion_id`, `importacion_id`, `fuente`, `fecha_hora`, `ms_reproducidos`, `aleatorio`, `salteada` |
| `actividad` | Acciones del usuario | `usuario_id`, `tipo`, `cancion_id`, `playlist_id`, `detalle` (jsonb), `fecha` |

```
usuarios ──< playlists (es_album=false) ──< canciones_playlists >── canciones
    │                                                                 │  │
    ├──< favoritos >──────────────────────────────────────────────────┤  │
    ├──< biblioteca (estado) >────────────────────────────────────────┤  │
    ├──< resenas (puntuación, comentario) >───────────────────────────┤  │
    ├──< actividad ──> canciones / playlists (opcionales) ────────────┘  │
    ├──< importaciones ──< reproducciones >── canciones ──> artistas ──< artistas_generos >── generos
    ├──< reproducciones                        └──> playlists (es_album=true = álbum) ──> artistas
    └──< refresh_tokens
```

### Cambios de la versión 6

El esquema se carga sobre una base **vacía**. Si venís de la versión 5, primero recreá la base con `npm run db:init -- --reset`.

- **`usuarios.nombre_usuario`**: obligatorio y único sin importar mayúsculas. Se guarda en
  minúsculas; 3 a 30 caracteres entre letras, números, `.` y `_`.
- **`actividad`**: una fila por cada acción del usuario sobre su biblioteca, favoritos, reseñas,
  playlists e importaciones. Se registra en la misma transacción que la acción. Si después se borra
  la canción o la playlist, su id queda en `NULL`, pero el nombre está copiado en `detalle` (jsonb)
  y la actividad se sigue pudiendo mostrar. Repetir algo que no cambia nada (marcar el mismo
  estado, un favorito que ya estaba) no genera actividad.
- **Se eliminó la tabla `puntuaciones`**: duplicaba `resenas.puntuacion`. Las puntuaciones van
  por `/api/me/resenas`.
- Se sacaron los `ALTER ... OWNER TO postgres`: el esquema se puede cargar con cualquier usuario.

### Cambios de la versión 5

Esta versión agregó datos que necesita el frontend. Si venís de la versión 4, hay que recrear la base y volver a importar el historial.

- **`biblioteca`**: estado de cada canción para el usuario (`quiero_escuchar` / `escuchando` /
  `escuchado`). Es independiente de `favoritos`: una canción puede estar escuchada y ser favorita.
- **`resenas`**: puntuación (1 a 5) y comentario, uno por usuario y canción.
- **`canciones.itunes_id` y `canciones.portada_url`**: datos de la API externa con la que el front
  explora el catálogo. Opcionales: lo importado de Spotify o Last.fm no los trae.

### Cambios de la versión 4

Estos cambios se hicieron para contemplar los datos que realmente entregan Spotify y Last.fm:

- **`canciones.duracion` y `canciones.album_id` opcionales**: ni el export ni Last.fm traen la
  duración de la canción, y Last.fm a veces no trae álbum.
- **Clave natural para deduplicar**: artista por `lower(nombre)`, álbum por `(artista, lower(nombre))`,
  canción por `(artista, lower(nombre))`. El export no trae URI de artista ni de álbum, y la misma
  canción tiene varias URIs (single, álbum, remaster); para el Wrapped conviene unificarlas.
  `spotify_uri` queda como dato informativo.
- **`reproducciones.ms_reproducidos` opcional** + `fuente` (`spotify` / `lastfm` / `manual`).
  Si falta, las vistas usan la duración de la canción o, si tampoco está, 3:30 (estimado; la API avisa
  con `minutosEstimados: true`).
- **`importaciones`**: una fila por archivo o sincronización; borrarla borra sus reproducciones (deshacer).
- **`refresh_tokens`**: solo guarda el hash SHA-256.
- **`usuarios.rol`** (`usuario` / `admin`) y **`usuarios.lastfm_usuario`**.
- **`artistas.generos_sincronizados_en`**: qué artistas ya se consultaron en Last.fm.

Los datos del Wrapped se calculan en estas vistas SQL: `wrapped_resumen`, `wrapped_top_canciones`, `wrapped_top_artistas`, `wrapped_top_generos` y `wrapped_habitos`. Las fechas se interpretan en horario de Buenos Aires y se cuenta como reproducción válida un stream de 30 segundos o más, siguiendo el criterio de Spotify.

---

## Inicio de sesión y seguridad

- **Access token**: JWT HS256 con `{ sub: id, rol }`, de `JWT_ACCESS_TTL` (2 h por defecto). Su
  expiración se valida siempre en el server (`requireAuth`, en cada request).
- Contraseñas con bcrypt; cambiar la contraseña revoca los refresh tokens y borra la cookie de esa sesión.
  Un JWT ya emitido en otro dispositivo sigue valiendo hasta que vence: es stateless.
- Login con mensaje genérico y comparación contra un hash falso: no revela qué emails existen.
- El rol viaja en el JWT: después de `npm run admin` hay que volver a loguearse.

### Para el navegador: cookie HttpOnly

`POST /api/auth/login` y `/register` guardan el JWT en la cookie `sesion` y el body solo trae
`{ usuario }`: JavaScript nunca ve un token, así que un XSS no se lo puede llevar.

- Flags: `HttpOnly`, `SameSite` (`COOKIE_SAMESITE`, `strict` por defecto) y `Secure` (con
  `NODE_ENV=production` o `SameSite=None`). `Path=/api`.
- CORS con `credentials: true`, solo para los orígenes de `CORS_ORIGIN`. El front usa `withCredentials`.
- **La sesión dura lo que dura el JWT o hasta el logout**: no se emite refresh token y no se renueva
  sola. Al vencer, la API responde `401` con `codigo: "TOKEN_VENCIDO"` y borra la cookie.
- Con front y back en dominios distintos, usar `COOKIE_SAMESITE=none` (fuerza `Secure`). El deploy actual
  no lo necesita, porque el front pasa por el rewrite de Vercel (ver [Dónde está alojado](#dónde-está-alojado)).

Los errores de sesión traen un `codigo` (`TOKEN_AUSENTE`, `TOKEN_INVALIDO`, `TOKEN_VENCIDO`). Así el
cliente los distingue de otros 401, como una contraseña incorrecta, que no deben cerrarle la sesión.

### Para otros clientes: `?modo=tokens`

Para clientes sin cookies (Postman, mobile): `POST /api/auth/login?modo=tokens` devuelve
`{ usuario, accessToken, refreshToken, tokenType }`. El access token se manda en
`Authorization: Bearer <token>`.

- **Refresh token**: string aleatorio opaco de 7 días; en la base solo va su hash.
  - **Rotación**: cada `/api/auth/refresh` revoca el usado y entrega uno nuevo.
  - **Detección de reuso**: si llega un refresh ya revocado (alguien lo robó), se cierran todas las sesiones del usuario.

Si una request da `401 Token vencido`: llamar a `/api/auth/refresh`, reemplazar los dos tokens y reintentar.

## Middlewares

Se ejecutan en este orden:

| Middleware | Para qué |
|---|---|
| `helmet` | Headers de seguridad |
| `cors` | Solo los orígenes de `CORS_ORIGIN`, con credenciales |
| `morgan` | Log de requests (apagado en test) |
| `express.json({ limit: '1mb' })` | Parseo del body |
| `cookieParser` | Parseo de la cookie de sesión |
| `authLimiter` | 20 intentos / 15 min por IP en login y registro |
| `resolverLimiter` | 60 altas / 15 min por usuario en `POST /api/canciones/resolver` |
| `requireAuth` / `requireRole('admin')` | Verifica el JWT (`Bearer` o cookie) y el rol |
| `validate({ body, query, params })` | Valida con zod; lo validado queda en `req.valid` |
| `uploadJson` (multer) | Hasta 20 archivos `.json` en memoria, máx. `MAX_UPLOAD_MB` c/u |
| `notFoundHandler` + `errorHandler` | 404 y errores. Traduce errores de PostgreSQL: UNIQUE → 409, FK inexistente → 400, FK en uso → 409, CHECK → 400. Reconoce los mensajes del servidor en inglés y en español |

Formato de error: `{ "error": "mensaje", "detalles": [...], "codigo": "..." }` (`detalles` y `codigo` son opcionales).

---

## Endpoints

Todas las rutas empiezan con `/api`. En [docs/API.md](docs/API.md) está el detalle de cada endpoint, con sus parámetros, respuestas, posibles errores y requisitos de autenticación.

Salvo las rutas de `/api/auth/*` y `/api/health`, hace falta iniciar sesión. Se puede autenticar con la cookie o enviando `Authorization: Bearer`.

Las listas aceptan paginación con `?page=1&limit=20` (el máximo es 100) y responden con `{ data, page, limit, total, totalPages }`. Las duraciones se expresan en **segundos**.

### Auth y perfil
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/api/auth/register` | `{ nombre_usuario, nombre, apellido, email, password, confirmacion }` | 201 `{ usuario }` + cookie. Con `?modo=tokens`: `{ usuario, accessToken, refreshToken, tokenType }`. 409 si el email o el nombre de usuario ya existen (con un mensaje distinto para cada caso) |
| POST | `/api/auth/login` | `{ email, password }` | 200 ídem |
| POST | `/api/auth/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken, tokenType }` |
| POST | `/api/auth/logout` | `{ refreshToken? }` | 204, borra la cookie |
| GET | `/api/me` | | perfil |
| PATCH | `/api/me` | `{ nombre_usuario?, nombre?, apellido?, lastfm_usuario?, avatar_url?, bio?, generos_preferidos?, artistas_preferidos? }` | perfil. Al menos un campo. `avatar_url` solo `http`/`https`; `bio` hasta 500 caracteres; las listas, hasta 20 textos |
| PUT | `/api/me/password` | `{ actual, nueva }` | 204 (cierra sesiones) |
| DELETE | `/api/me` | `{ password }` | 204 (borra todo en cascada) |

### Historial e importaciones
| Método | Ruta | Detalle |
|---|---|---|
| POST | `/api/me/importaciones/spotify` | `multipart/form-data`, campo `archivos` (uno o varios). Acepta `Streaming_History_Audio_*.json` (extendido) y `StreamingHistory_music_*.json` (básico). Reimportar no duplica |
| POST | `/api/me/importaciones/lastfm` | `{ usuario?, desde?, hasta? }`. Sin `desde`, sigue desde el último scrobble importado. Hasta 10.000 por llamada (`completo: false` si quedan) |
| GET | `/api/me/importaciones` | Lista con filas leídas / insertadas / descartadas |
| DELETE | `/api/me/importaciones/:id` | Deshace la importación |
| GET | `/api/me/reproducciones` | Paginado, `?desde=&hasta=` (ISO 8601) |
| POST | `/api/me/reproducciones` | `{ cancionId, fechaHora?, msReproducidos? }` (carga manual) |
| DELETE | `/api/me/reproducciones/:id` | |
| POST | `/api/generos/sincronizar` | `{ limite? }` (máx. 100). Completa géneros con Last.fm de los artistas que escuchaste (admin: de todos) |

### Wrapped
| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/me/wrapped` | Años con datos + resumen de cada uno |
| GET | `/api/me/wrapped/:anio` | Todo junto: `resumen`, `topCanciones`, `topArtistas`, `topGeneros` (top 5), `habitos` (día, hora y franja favorita, minutos por día), `porMes`, `minutosEstimados` |
| GET | `/api/me/wrapped/:anio/canciones?limit=50` | Ranking completo |
| GET | `/api/me/wrapped/:anio/artistas?limit=50` | |
| GET | `/api/me/wrapped/:anio/generos?limit=50` | Con `porcentaje` sobre los streams del año (puede sumar más de 100%: un artista tiene varios géneros) |
| GET | `/api/me/wrapped/:anio/habitos` | `porDia` (7), `porHora` (24) y `heatmap` día × hora |
| GET | `/api/me/wrapped/:anio/meses` | Minutos y streams de los 12 meses |

### Biblioteca
| Método | Ruta | Body |
|---|---|---|
| GET / POST | `/api/me/playlists` | `{ nombre }` |
| GET / PATCH / DELETE | `/api/me/playlists/:id` | `{ nombre }` |
| POST | `/api/me/playlists/:id/canciones` | `{ cancionId }` |
| DELETE | `/api/me/playlists/:id/canciones/:cancionId` | |
| GET | `/api/me/favoritos` | paginado |
| PUT / DELETE | `/api/me/favoritos/:cancionId` | (PUT es idempotente) |
| GET | `/api/me/biblioteca?estado=` | paginado; filtro opcional por estado |
| PUT / DELETE | `/api/me/biblioteca/:cancionId` | `{ estado }`: `quiero_escuchar`, `escuchando` o `escuchado` |
| GET | `/api/me/resenas` | paginado |
| PUT / DELETE | `/api/me/resenas/:cancionId` | `{ puntuacion?, comentario? }` (1 a 5; solo cambia lo que se manda) |
| GET | `/api/me/canciones/estado?artista=&nombre=` | `{ id, estado, favorito, resena, playlists }` de esa canción para el usuario; `id: null` si no está en el catálogo |

Una playlist de otro usuario o un álbum responden **404** (no 403), para no revelar que existe.

### Actividad y estadísticas
| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/me/actividad?tipo=` | Paginado, lo más reciente primero. `tipo` filtra por grupo: `biblioteca`, `favorito`, `resena`, `playlist` o `importacion`. Cada fila: `{ id, tipo, fecha, detalle, playlist_id, cancion }`; `cancion` es `null` si se borró (el nombre sigue en `detalle`) |
| GET | `/api/me/estadisticas` | Todo junto: `biblioteca` (total, `porEstado`, `porcentajeEscuchado`, `escuchadasEsteAnio`, `artistasDistintos`), `favoritos`, `playlists`, `resenas` (total, promedio, distribución 1 a 5), `topArtistas`, `topGeneros`, `mejorPuntuadas`, `actividad` (`porMes`, `diasActivosUltimos30`) |

Tipos de actividad: `biblioteca_agregar`, `biblioteca_estado`, `biblioteca_quitar`,
`favorito_agregar`, `favorito_quitar`, `resena_crear`, `resena_editar`, `resena_borrar`,
`playlist_crear`, `playlist_renombrar`, `playlist_borrar`, `playlist_agregar_cancion`,
`playlist_quitar_cancion` e `importacion`.

Las estadísticas son de la **biblioteca** (lo que el usuario guardó, puntuó y organizó). Las de lo
que **escuchó** están en el Wrapped.

### Catálogo (lectura: cualquier usuario; escritura: admin)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/generos` | con cantidad de artistas |
| POST / PATCH / DELETE | `/api/generos`, `/api/generos/:id` | `{ nombre }` |
| GET | `/api/artistas?q=&generoId=` | paginado, con géneros |
| GET | `/api/artistas/:id` | géneros, álbumes, cantidad de canciones |
| POST / PATCH / DELETE | `/api/artistas`, `/api/artistas/:id` | `{ nombre }`; no se borra si tiene canciones (409) |
| PUT | `/api/artistas/:id/generos` | `{ generoIds: [] }` reemplaza la lista |
| GET | `/api/albumes/:id` | con canciones y duración |
| POST / PATCH / DELETE | `/api/albumes`, `/api/albumes/:id` | `{ nombre, artistaId, fechaLanzamiento? }` |
| GET | `/api/canciones?q=&artistaId=` | paginado; `q` busca en canción y artista |
| GET | `/api/canciones/:id` | |
| POST / PATCH / DELETE | `/api/canciones`, `/api/canciones/:id` | `{ nombre, artistaId, albumId?, duracionSegundos? }`; no se borra si tiene historial (409) |
| POST | `/api/canciones/resolver` | **Cualquier usuario.** `{ nombre, artista, album?, duracionSegundos?, itunesId?, portadaUrl? }`: devuelve la canción del catálogo para una de la API externa, creándola si hace falta. Usa la misma clave natural que las importaciones y nunca pisa datos existentes. `portadaUrl` solo del CDN de Apple |

---

## Cómo está organizado el backend

```
Clientes ──> Controllers ──> Services ──> Repositories ──> PostgreSQL
             auth            auth         usuarios, tokens
             catalogo        catalogo     catalogo
             biblioteca      biblioteca   biblioteca
             historial       historial    historial, importador
             wrapped         wrapped      wrapped
             actividad       actividad    actividad
             estadisticas    estadisticas estadisticas
                             + tokens, generos, importador (usados por otros services)
                             + lastfm (API externa), spotifyParser (archivos)
```

| Capa | Hace | No hace |
|---|---|---|
| **Controllers** | Definen las rutas, validan con zod, eligen el status HTTP | SQL, reglas de negocio |
| **Services** | Reglas de negocio, transacciones, errores (`notFound`, `conflict`...), llaman a otros services y a Last.fm | Tocar `req` / `res`, SQL |
| **Repositories** | Todo el SQL. Devuelven filas | Decidir qué hacer si no hay resultado |

Las dependencias siguen ese sentido: controllers → services → repositories. Cuando una operación necesita una transacción, el service la abre con `withTransaction` y pasa el `client` a los repositorios mediante el último parámetro (`db`).

## Estructura

```
db/schema.sql            esquema v6 (tablas, constraints, vistas wrapped_*)
src/
  app.js                 arma Express (sin listen, para testear)
  server.js              listen + cierre prolijo
  config.js              variables de entorno validadas con zod
  db.js                  pool de pg, transacciones, parsers de tipos
  middlewares/           auth, validate, errorHandler, upload, rateLimit
  controllers/           auth (+ /me), historial, wrapped, biblioteca, catalogo, actividad, estadisticas
  services/
    auth.js              registro, login, perfil, contraseña
    biblioteca.js        playlists, favoritos, estados y reseñas (+ su registro en actividad)
    actividad.js         lista la actividad del usuario
    estadisticas.js      arma las estadísticas de la biblioteca
    catalogo.js          géneros, artistas, álbumes, canciones
    historial.js         reproducciones e importaciones
    wrapped.js           arma las respuestas de las estadísticas
    tokens.js            JWT + refresh tokens con rotación
    spotifyParser.js     normaliza los dos formatos del export
    lastfm.js            cliente de Last.fm (scrobbles y tags)
    importador.js        carga por lotes en una transacción
    generos.js           tags de Last.fm → géneros
  repositories/          SQL: usuarios, tokens, biblioteca, catalogo, historial, importador, wrapped,
                         actividad, estadisticas
scripts/
  init-db.js             carga el esquema (npm run db:init)
  seed-demo.js           cuenta demo (npm run db:seed)
  promover-admin.js      da rol admin (npm run admin)
test/                    tests de integración (node:test + supertest)
```

## Algunas decisiones del proyecto

- **Rendimiento**: importar un archivo de 15.000 reproducciones tarda ~1,2 s y el Wrapped
  completo ~230 ms. Después de cada importación grande se corre `ANALYZE` para que el
  planificador no use estadísticas viejas.
- **Spotify + Last.fm en la misma cuenta duplican escuchas**: Spotify registra cuándo terminó la
  canción y Last.fm cuándo empezó, así que `reproducciones_uq` no las detecta como iguales.
  Conviene usar una sola fuente por usuario.
- **Refresh token solo con `?modo=tokens`**: el navegador usa cookie y no se renueva. Tiene una razón
  práctica además de la consigna: con rotación y detección de reuso, dos pestañas renovando a la vez
  se detectan como un robo y cierran todas las sesiones.
- **Importación sincrónica**: alcanza para un TP. Con archivos de cientos de miles de filas convendría
  una cola de trabajos.
