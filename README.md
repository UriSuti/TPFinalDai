# Spotify Wrapped — Backend

API REST en **Node.js + Express 5 + PostgreSQL** para el resumen musical estilo Spotify Wrapped:
artistas y canciones más escuchados, géneros que predominan y hábitos de escucha, a partir del
historial real del usuario.

## Arranque rápido

```bash
npm install
cp .env.example .env               # completar DATABASE_URL y JWT_SECRET
createdb spotify_wrapped
npm run db:init                     # carga db/schema.sql
npm run dev                         # http://localhost:3000
npm run admin -- tu@mail.com        # (opcional) darle rol admin a un usuario ya registrado
```

Tests de integración (40, contra un PostgreSQL real y un Last.fm falso local):

```bash
createdb spotify_wrapped_test
npm test                            # usa TEST_DATABASE_URL o postgres://postgres@localhost:5432/spotify_wrapped_test
```

Requiere Node 20+ y PostgreSQL 12+.

---

## ¿Hace falta una API externa?

| Fuente | Qué da | Problema | Decisión |
|---|---|---|---|
| **Export de Spotify** (Privacidad → Descargar tus datos) | Historial completo: fecha, canción, artista, álbum, ms escuchados, shuffle, salteada | Tarda días (extendido: hasta 30). No trae géneros ni duración de la canción | **Fuente principal.** Se sube el JSON |
| **Last.fm API** | Scrobbles con fecha (todo el historial) + tags por artista | No trae cuánto se escuchó; los tags son texto libre | **Fuente alternativa y para los géneros.** Solo API key gratis, sin OAuth |
| **Spotify Web API** | Metadata, top items, últimas 50 escuchas | Desde feb-2026 en modo desarrollo: el dueño de la app necesita Premium, máximo 5 usuarios, sin endpoints por lotes y búsqueda limitada a 10 resultados. "Recently played" solo trae 50 escuchas, no sirve para un resumen anual | **No se usa** |

Conclusión: el Wrapped se arma con el **export de Spotify** (o con **Last.fm** si alguien del grupo
lo usa), y **Last.fm** completa los **géneros** (`artist.getTopTags`). Sin `LASTFM_API_KEY`
la importación de Spotify funciona igual; solo quedan desactivados Last.fm y los géneros.

---

## Modelo de datos (db/schema.sql, v4)

```
usuarios ──< playlists (es_album=false) ──< canciones_playlists >── canciones
    │                                                                 │  │
    ├──< favoritos >──────────────────────────────────────────────────┘  │
    ├──< importaciones ──< reproducciones >── canciones ──> artistas ──< artistas_generos >── generos
    ├──< reproducciones                        └──> playlists (es_album=true = álbum) ──> artistas
    └──< refresh_tokens
```

Cambios respecto de la v3, todos por lo que traen las fuentes reales:

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

La lógica del Wrapped vive en vistas SQL (`wrapped_resumen`, `wrapped_top_canciones`,
`wrapped_top_artistas`, `wrapped_top_generos`, `wrapped_habitos`): fechas en hora de Buenos Aires
y "stream" = 30 s o más (criterio de Spotify).

---

## Autenticación

- **Access token**: JWT HS256 de 15 min con `{ sub: id, rol }`. Va en `Authorization: Bearer <token>`.
- **Refresh token**: string aleatorio opaco de 7 días; en la base solo va su hash.
  - **Rotación**: cada `/auth/refresh` revoca el usado y entrega uno nuevo.
  - **Detección de reuso**: si llega un refresh ya revocado (alguien lo robó), se cierran todas las sesiones del usuario.
- Contraseñas con bcrypt; cambiar la contraseña cierra todas las sesiones.
- Login con mensaje genérico y comparación contra un hash falso: no revela qué emails existen.
- El rol viaja en el JWT: después de `npm run admin` hay que volver a loguearse.

Flujo del front: guardar ambos tokens → si una request da `401 Token vencido`, llamar a
`/auth/refresh`, reemplazar los dos tokens y reintentar.

## Middlewares (en orden)

| Middleware | Para qué |
|---|---|
| `helmet` | Headers de seguridad |
| `cors` | Solo los orígenes de `CORS_ORIGIN` |
| `morgan` | Log de requests (apagado en test) |
| `express.json({ limit: '1mb' })` | Parseo del body |
| `authLimiter` | 20 intentos / 15 min por IP en login y registro |
| `requireAuth` / `requireRole('admin')` | Verifica el JWT y el rol |
| `validate({ body, query, params })` | Valida con zod; lo validado queda en `req.valid` |
| `uploadJson` (multer) | Hasta 20 archivos `.json` en memoria, máx. `MAX_UPLOAD_MB` c/u |
| `notFoundHandler` + `errorHandler` | 404 y errores. Traduce errores de PostgreSQL: UNIQUE → 409, FK inexistente → 400, FK en uso → 409, CHECK → 400 |

Formato de error: `{ "error": "mensaje", "detalles": [...] }`.

---

## Endpoints

Todo lo que no sea `/auth/*` ni `/health` requiere `Authorization: Bearer`.
Las listas paginadas aceptan `?page=1&limit=20` (máx. 100) y devuelven `{ data, page, limit, total, totalPages }`.
Las duraciones salen en **segundos**.

### Auth y perfil
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/auth/register` | `{ nombre, apellido, email, password }` | 201 `{ usuario, accessToken, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` | 200 ídem |
| POST | `/auth/refresh` | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | `{ refreshToken }` | 204 |
| GET | `/me` | | perfil |
| PATCH | `/me` | `{ nombre?, apellido?, lastfm_usuario? }` | perfil |
| PUT | `/me/password` | `{ actual, nueva }` | 204 (cierra sesiones) |
| DELETE | `/me` | `{ password }` | 204 (borra todo en cascada) |

### Historial e importaciones
| Método | Ruta | Detalle |
|---|---|---|
| POST | `/me/importaciones/spotify` | `multipart/form-data`, campo `archivos` (uno o varios). Acepta `Streaming_History_Audio_*.json` (extendido) y `StreamingHistory_music_*.json` (básico). Reimportar no duplica |
| POST | `/me/importaciones/lastfm` | `{ usuario?, desde?, hasta? }`. Sin `desde`, sigue desde el último scrobble importado. Hasta 10.000 por llamada (`completo: false` si quedan) |
| GET | `/me/importaciones` | Lista con filas leídas / insertadas / descartadas |
| DELETE | `/me/importaciones/:id` | Deshace la importación |
| GET | `/me/reproducciones` | Paginado, `?desde=&hasta=` (ISO 8601) |
| POST | `/me/reproducciones` | `{ cancionId, fechaHora?, msReproducidos? }` (carga manual) |
| DELETE | `/me/reproducciones/:id` | |
| POST | `/generos/sincronizar` | `{ limite? }` (máx. 100). Completa géneros con Last.fm de los artistas que escuchaste (admin: de todos) |

### Wrapped
| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/me/wrapped` | Años con datos + resumen de cada uno |
| GET | `/me/wrapped/:anio` | Todo junto: `resumen`, `topCanciones`, `topArtistas`, `topGeneros` (top 5), `habitos` (día, hora y franja favorita, minutos por día), `porMes`, `minutosEstimados` |
| GET | `/me/wrapped/:anio/canciones?limit=50` | Ranking completo |
| GET | `/me/wrapped/:anio/artistas?limit=50` | |
| GET | `/me/wrapped/:anio/generos?limit=50` | Con `porcentaje` sobre los streams del año (puede sumar más de 100%: un artista tiene varios géneros) |
| GET | `/me/wrapped/:anio/habitos` | `porDia` (7), `porHora` (24) y `heatmap` día × hora |
| GET | `/me/wrapped/:anio/meses` | Minutos y streams de los 12 meses |

### Biblioteca
| Método | Ruta | Body |
|---|---|---|
| GET / POST | `/me/playlists` | `{ nombre }` |
| GET / PATCH / DELETE | `/me/playlists/:id` | `{ nombre }` |
| POST | `/me/playlists/:id/canciones` | `{ cancionId }` |
| DELETE | `/me/playlists/:id/canciones/:cancionId` | |
| GET | `/me/favoritos` | paginado |
| PUT / DELETE | `/me/favoritos/:cancionId` | (PUT es idempotente) |

Una playlist de otro usuario o un álbum responden **404** (no 403), para no revelar que existe.

### Catálogo (lectura: cualquier usuario; escritura: admin)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/generos` | con cantidad de artistas |
| POST / PATCH / DELETE | `/generos`, `/generos/:id` | `{ nombre }` |
| GET | `/artistas?q=&generoId=` | paginado, con géneros |
| GET | `/artistas/:id` | géneros, álbumes, cantidad de canciones |
| POST / PATCH / DELETE | `/artistas`, `/artistas/:id` | `{ nombre }`; no se borra si tiene canciones (409) |
| PUT | `/artistas/:id/generos` | `{ generoIds: [] }` reemplaza la lista |
| GET | `/albumes/:id` | con canciones y duración |
| POST / PATCH / DELETE | `/albumes`, `/albumes/:id` | `{ nombre, artistaId, fechaLanzamiento? }` |
| GET | `/canciones?q=&artistaId=` | paginado; `q` busca en canción y artista |
| GET | `/canciones/:id` | |
| POST / PATCH / DELETE | `/canciones`, `/canciones/:id` | `{ nombre, artistaId, albumId?, duracionSegundos? }`; no se borra si tiene historial (409) |

---

## Estructura

```
db/schema.sql            esquema v4 (tablas, constraints, vistas wrapped_*)
src/
  app.js                 arma Express (sin listen, para testear)
  server.js              listen + cierre prolijo
  config.js              variables de entorno validadas con zod
  db.js                  pool de pg, transacciones, parsers de tipos
  middlewares/           auth, validate, errorHandler, upload, rateLimit
  routes/                auth (+ /me), historial, wrapped, biblioteca, catalogo
  services/
    tokens.js            JWT + refresh tokens con rotación
    spotifyParser.js     normaliza los dos formatos del export
    lastfm.js            cliente de Last.fm (scrobbles y tags)
    importador.js        carga por lotes con unnest() en una transacción
    generos.js           tags de Last.fm → géneros
scripts/promover-admin.js
test/                    tests de integración (node:test + supertest)
```

## Decisiones a tener en cuenta

- **Rendimiento**: importar un archivo de 15.000 reproducciones tarda ~1,2 s y el Wrapped
  completo ~230 ms. Después de cada importación grande se corre `ANALYZE` para que el
  planificador no use estadísticas viejas.
- **Spotify + Last.fm en la misma cuenta duplican escuchas**: Spotify registra cuándo terminó la
  canción y Last.fm cuándo empezó, así que `reproducciones_uq` no las detecta como iguales.
  Conviene usar una sola fuente por usuario.
- **Refresh token en el body**: es más simple para el front. En producción es más seguro mandarlo en
  una cookie `httpOnly`, pero requiere configurar CORS con credenciales.
- **Importación sincrónica**: alcanza para un TP. Con archivos de cientos de miles de filas convendría
  una cola de trabajos.
