# Referencia de la API

Todas las rutas cuelgan de `/api` y hablan JSON (salvo la subida de archivos, que es `multipart/form-data`).
Esta referencia se armó leyendo los controllers, services y repositories del backend.

## Convenciones

**Autenticación.** Salvo que la tabla diga "No", hace falta sesión. Se acepta cualquiera de las dos:

- la cookie `sesion` (HttpOnly) que el backend setea en `login` y `register` (modo por defecto, navegador);
- el header `Authorization: Bearer <accessToken>` (clientes sin cookies; se obtiene con `?modo=tokens`).

Los roles son `usuario` y `admin`. En la columna **Auth**, "Admin" significa sesión con rol `admin`.

**Paginación.** Las listas paginadas aceptan `?page=1&limit=20` (`limit` máximo 100) y responden:

```json
{ "data": [], "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
```

**Duraciones.** Siempre en segundos (entero).

**Errores.** Todos tienen la forma `{ "error": "mensaje" }`, y opcionalmente `detalles` y `codigo`:

| Status | Cuándo | Ejemplo de body |
|---|---|---|
| 400 | Datos inválidos, JSON mal formado, referencia a algo que no existe | `{ "error": "Datos inválidos", "detalles": [{ "campo": "body.email", "mensaje": "Email inválido" }] }` |
| 401 | Sin sesión, token inválido o vencido, credenciales incorrectas | `{ "error": "Token vencido", "codigo": "TOKEN_VENCIDO" }` |
| 403 | Falta el rol necesario (`admin`) | `{ "error": "No tenés permiso para esta acción" }` |
| 404 | El recurso no existe **o es de otro usuario** (no se distingue a propósito) | `{ "error": "Playlist no encontrada" }` |
| 409 | Valor duplicado (UNIQUE) o no se puede borrar porque otros datos lo usan | `{ "error": "Ese nombre de usuario ya está en uso" }` |
| 413 | Body o archivo demasiado grande | `{ "error": "El body es demasiado grande" }` |
| 429 | Demasiados intentos en login o registro (20 cada 15 min por IP), o más de 60 altas en `POST /canciones/resolver` en 15 min por usuario | `{ "error": "Demasiados intentos, probá de nuevo en unos minutos" }` (login y registro) o `{ "error": "Demasiadas solicitudes, probá de nuevo en unos minutos" }` (resolver) |
| 500 | Error interno (en producción el mensaje es genérico) | `{ "error": "Error interno del servidor" }` |
| 502 / 503 | Falla de Last.fm (no responde, límite de requests, falta `LASTFM_API_KEY`) | `{ "error": "Last.fm no está configurado (falta LASTFM_API_KEY)" }` |

Los 401 de sesión traen `codigo`: `TOKEN_AUSENTE`, `TOKEN_INVALIDO` o `TOKEN_VENCIDO`. Los demás 401
(por ejemplo, contraseña incorrecta) no traen código.

**Objeto `usuario`** (lo devuelven register, login, `GET /me` y `PATCH /me`):

```json
{
  "id": 1, "nombre_usuario": "demo", "nombre": "Cami", "apellido": "Demo",
  "email": "demo@mycollection.app", "rol": "usuario", "lastfm_usuario": null,
  "avatar_url": null, "bio": null,
  "generos_preferidos": [], "artistas_preferidos": [],
  "fecha_registro": "2026-11-16T12:00:00.000Z"
}
```

**Objeto `cancion` de los listados personales** (favoritos, biblioteca y reseñas) usa estas columnas base:
`id, nombre, duracion, itunes_id, portada_url, artista_id, artista`, más las que se indican en cada endpoint.

---

## Salud

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/health` | No | | 200 `{ "ok": true }` (consulta la base) |

## Autenticación

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/api/auth/register` | No (con límite de intentos) | `{ nombre_usuario, nombre, apellido, email, password, confirmacion }` | **201** `{ usuario }` y setea la cookie. Con `?modo=tokens`: `{ usuario, accessToken, refreshToken, tokenType: "Bearer" }`. Errores: 400, 409 (email o nombre de usuario ya existente, con mensaje distinto), 429 |
| POST | `/api/auth/login` | No (con límite de intentos) | `{ email, password }` | **200** igual que register. Errores: 401 `Email o contraseña incorrectos`, 429 |
| POST | `/api/auth/refresh` | No | `{ refreshToken }` | **200** `{ accessToken, refreshToken, tokenType }`. Rota el refresh token. Errores: 401 (inválido, vencido o reutilizado: en ese caso se cierran todas las sesiones) |
| POST | `/api/auth/logout` | No | `{ refreshToken? }` (opcional) | **204**. Borra la cookie y, si se manda el refresh token, lo revoca |

Reglas de los campos de registro: `nombre_usuario` de 3 a 30 caracteres entre letras, números, `.` y `_` (se guarda en
minúsculas); `nombre` y `apellido` de 1 a 100; `email` válido de hasta 254; `password` de 8 caracteres como mínimo y 72 bytes
como máximo; `confirmacion` igual a `password`.

## Perfil del usuario

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/me` | Sí | | **200** `usuario`. 404 si el usuario ya no existe |
| PATCH | `/api/me` | Sí | Al menos uno de: `nombre_usuario`, `nombre`, `apellido`, `lastfm_usuario` (o `null`), `avatar_url` (URL http/https o `null`), `bio` (hasta 500, o `null`), `generos_preferidos[]`, `artistas_preferidos[]` (hasta 20 textos de hasta 80) | **200** `usuario` actualizado. 400, 409 (nombre de usuario en uso) |
| PUT | `/api/me/password` | Sí | `{ actual, nueva }` | **204**. Revoca los refresh tokens y borra la cookie. 401 si `actual` no es correcta |
| DELETE | `/api/me` | Sí | `{ password }` | **204**. Borra la cuenta y todos sus datos en cascada, y borra la cookie. 401 si la contraseña no es correcta |

## Playlists (colecciones)

Las playlists son siempre del usuario logueado. Una playlist ajena responde 404.

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/playlists` | Sí | | **200** `[{ id, nombre, fecha_creacion, duracion, canciones }]` (`canciones` es la cantidad) |
| POST | `/api/me/playlists` | Sí | `{ nombre }` (1 a 200) | **201** `{ id, nombre, fecha_creacion }` |
| GET | `/api/me/playlists/:id` | Sí | | **200** `{ id, nombre, fecha_creacion, duracion, canciones: [{ id, nombre, duracion, itunes_id, portada_url, artista, fecha_agregada }] }`. 404 |
| PATCH | `/api/me/playlists/:id` | Sí | `{ nombre }` | **200** `{ id, nombre, fecha_creacion }`. 404 |
| DELETE | `/api/me/playlists/:id` | Sí | | **204**. 404 |
| POST | `/api/me/playlists/:id/canciones` | Sí | `{ cancionId }` | **201** `{ "agregada": true }`; **200** `{ "agregada": false }` si ya estaba. 404 (playlist), 400 (la canción no existe) |
| DELETE | `/api/me/playlists/:id/canciones/:cancionId` | Sí | | **204**. 404 si la playlist o la canción en la playlist no existen |

## Favoritos

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/favoritos` | Sí | | **200** paginado; cada fila: columnas base + `fecha_agregada` |
| PUT | `/api/me/favoritos/:cancionId` | Sí | | **201** `{ "favorito": true }` si era nuevo; **200** igual si ya lo era (idempotente). 400 si la canción no existe |
| DELETE | `/api/me/favoritos/:cancionId` | Sí | | **204**. 404 si no estaba en favoritos |

## Biblioteca (estado de cada canción)

Estados válidos: `quiero_escuchar`, `escuchando`, `escuchado`.

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/biblioteca?estado=` | Sí | | **200** paginado; cada fila: columnas base + `estado`, `fecha_actualizacion`. `estado` es opcional |
| PUT | `/api/me/biblioteca/:cancionId` | Sí | `{ estado }` | **200** `{ cancion_id, estado, fecha_agregada, fecha_actualizacion }`. Crea o actualiza. 400 si la canción no existe |
| DELETE | `/api/me/biblioteca/:cancionId` | Sí | | **204**. 404 si no estaba en la biblioteca |

## Reseñas y puntuaciones

Hay una reseña por usuario y canción. Puede tener solo puntuación, solo comentario o ambos.

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/resenas` | Sí | | **200** paginado; cada fila: columnas base + `puntuacion`, `comentario`, `fecha_actualizacion` |
| PUT | `/api/me/resenas/:cancionId` | Sí | `{ puntuacion?, comentario? }` (puntuación entera de 1 a 5; comentario de 1 a 2000; al menos uno) | **200** `{ cancion_id, puntuacion, comentario, fecha_creacion, fecha_actualizacion }`. Solo cambia lo que se manda. 400 si la canción no existe |
| DELETE | `/api/me/resenas/:cancionId` | Sí | | **204**. 404 si no había reseña |

## Relación del usuario con una canción

| Método | Ruta | Auth | Query | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/canciones/estado` | Sí | `artista`, `nombre` (obligatorios) | **200** `{ id, estado, favorito, resena: { puntuacion, comentario } \| null, playlists: [ids] }`. Si la canción no está en el catálogo: `{ id: null, estado: null, favorito: false, resena: null, playlists: [] }` |

## Actividad

| Método | Ruta | Auth | Query | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/actividad` | Sí | `page`, `limit`, `tipo` (`biblioteca`, `favorito`, `resena`, `playlist` o `importacion`) | **200** paginado, lo más reciente primero. Cada fila: `{ id, tipo, fecha, detalle, playlist_id, cancion }`. `cancion` es `{ id, nombre, artista, itunes_id, portada_url }` o `null` si se borró (el nombre queda en `detalle`) |

Valores de `tipo` en cada fila: `biblioteca_agregar`, `biblioteca_estado`, `biblioteca_quitar`, `favorito_agregar`,
`favorito_quitar`, `resena_crear`, `resena_editar`, `resena_borrar`, `playlist_crear`, `playlist_renombrar`,
`playlist_borrar`, `playlist_agregar_cancion`, `playlist_quitar_cancion`, `importacion`.

## Estadísticas de la biblioteca

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| GET | `/api/me/estadisticas` | Sí | **200** ver abajo. Se calcula en cada pedido |

```json
{
  "biblioteca": { "total": 17, "porEstado": { "quiero_escuchar": 4, "escuchando": 4, "escuchado": 9 },
                  "porcentajeEscuchado": 53, "escuchadasEsteAnio": 9, "artistasDistintos": 14 },
  "favoritos": 6,
  "playlists": { "total": 3, "canciones": 12 },
  "resenas": { "total": 9, "puntuadas": 9, "conComentario": 5, "promedio": 4.4,
               "distribucion": [{ "puntuacion": 1, "cantidad": 0 }, "... hasta 5"] },
  "topArtistas": [{ "artista_id": 1, "artista": "Soda Stereo", "canciones": 2, "puntuacion_promedio": 5 }],
  "topGeneros": [{ "genero_id": 1, "genero": "Rock nacional", "canciones": 8, "porcentaje": 47.1 }],
  "mejorPuntuadas": [{ "id": 1, "nombre": "Crimen", "artista": "Gustavo Cerati", "itunes_id": 1, "portada_url": "...", "puntuacion": 5 }],
  "actividad": { "porMes": [{ "mes": "2026-11", "acciones": 14 }], "diasActivosUltimos30": 6 }
}
```

Los valores son un ejemplo ilustrativo; lo que importa es la estructura. `porMes` cubre los últimos 6 meses (los meses
sin actividad vienen con `acciones: 0`).

## Historial de escucha e importaciones

| Método | Ruta | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| GET | `/api/me/reproducciones` | Sí | `page`, `limit`, `desde`, `hasta` (ISO 8601 con zona) | **200** paginado; cada fila: `{ id, fecha_hora, ms_reproducidos, fuente, plataforma, aleatorio, salteada, cancion_id, cancion, artista_id, artista }` |
| POST | `/api/me/reproducciones` | Sí | `{ cancionId, fechaHora?, msReproducidos? }` (`msReproducidos` de 0 a 86.400.000) | **201** `{ id, cancion_id, fuente: "manual", fecha_hora, ms_reproducidos }`. 400 si la canción no existe, 409 si ya hay una reproducción igual en esa fecha |
| DELETE | `/api/me/reproducciones/:id` | Sí | | **204**. 404 |
| GET | `/api/me/importaciones` | Sí | | **200** `[{ id, fuente, detalle, fecha, filas_leidas, filas_insertadas, filas_descartadas }]` |
| POST | `/api/me/importaciones/spotify` | Sí | `multipart/form-data`, campo `archivos` (hasta 20 `.json`, tamaño máximo `MAX_UPLOAD_MB` cada uno) | **201** arreglo con una importación por archivo: los campos de arriba más `filas_duplicadas`. 400 (sin archivos, no es `.json`, o no tiene reproducciones de música), 413. Reimportar el mismo archivo no duplica |
| POST | `/api/me/importaciones/lastfm` | Sí | `{ usuario?, desde?, hasta? }`. Sin `usuario`, usa el guardado en el perfil | **201** importación + `completo` (`false` si había más de 10.000 scrobbles). 400 (sin usuario de Last.fm), 404 (usuario inexistente en Last.fm), 502, 503 |
| DELETE | `/api/me/importaciones/:id` | Sí | | **204**. Borra la importación y sus reproducciones. 404 |

## Wrapped

Todos los endpoints son del usuario logueado. `:anio` va entre 2000 y 2100. Las fechas se calculan en hora de Buenos Aires.

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| GET | `/api/me/wrapped` | Sí | **200** `[{ anio, minutos_escuchados, streams, canciones_distintas, artistas_distintos }]`, del año más reciente al más viejo |
| GET | `/api/me/wrapped/:anio` | Sí | **200** `{ anio, resumen, topCanciones, topArtistas, topGeneros, habitos, porMes, minutosEstimados }`. 404 si no hay reproducciones ese año |
| GET | `/api/me/wrapped/:anio/canciones?limit=50` | Sí | **200** `[{ puesto, cancion_id, cancion, artista_id, artista, streams, minutos }]` |
| GET | `/api/me/wrapped/:anio/artistas?limit=50` | Sí | **200** `[{ puesto, artista_id, artista, streams, minutos }]` |
| GET | `/api/me/wrapped/:anio/generos?limit=50` | Sí | **200** `[{ puesto, genero_id, genero, streams, porcentaje }]` (el porcentaje puede sumar más de 100) |
| GET | `/api/me/wrapped/:anio/habitos` | Sí | **200** `{ diaFavorito, horaFavorita, franjaFavorita, salteadas, porDia: [{ dia, minutos, streams }], porHora: [{ hora, minutos, streams }], heatmap: [{ dia_semana, hora, streams, minutos, salteadas }] }` |
| GET | `/api/me/wrapped/:anio/meses` | Sí | **200** arreglo de 12 `{ mes, minutos, streams }` |

`limit` va de 1 a 100 (por defecto 50). En `GET /api/me/wrapped/:anio`, los tres tops traen los 5 primeros, `habitos`
trae el resumen sin `porHora` ni `heatmap`, y `minutosEstimados` es `true` si hay reproducciones sin duración (Last.fm).

## Catálogo

Lectura: cualquier usuario logueado. Escritura: solo `admin`, salvo `POST /canciones/resolver` y
`POST /generos/sincronizar`.

### Géneros

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/generos` | Sí | | **200** `[{ id, nombre, artistas }]` |
| POST | `/api/generos` | Admin | `{ nombre }` | **201** `{ id, nombre }`. 409 si ya existe (sin importar mayúsculas) |
| PATCH | `/api/generos/:id` | Admin | `{ nombre }` | **200** `{ id, nombre }`. 404, 409 |
| DELETE | `/api/generos/:id` | Admin | | **204**. 404, 409 si hay artistas con ese género |
| POST | `/api/generos/sincronizar` | Sí | `{ limite? }` (1 a 100, por defecto 25) | **200** `{ procesados, conGeneros, errores: [{ artista, error }], pendientes }`. Completa géneros con Last.fm; un usuario sincroniza los artistas que escuchó, un admin todos. 503 si falta `LASTFM_API_KEY` o hay límite de requests |

### Artistas

| Método | Ruta | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| GET | `/api/artistas` | Sí | `page`, `limit`, `q` (nombre), `generoId` | **200** paginado `[{ id, nombre, generos: [{ id, nombre }] }]` |
| GET | `/api/artistas/:id` | Sí | | **200** `{ id, nombre, generos_sincronizados_en, generos, albumes: [{ id, nombre, fecha_lanzamiento }], canciones }`. 404 |
| POST | `/api/artistas` | Admin | `{ nombre }` | **201** `{ id, nombre }`. 409 |
| PATCH | `/api/artistas/:id` | Admin | `{ nombre }` | **200** `{ id, nombre }`. 404, 409 |
| DELETE | `/api/artistas/:id` | Admin | | **204**. 404, 409 si tiene canciones o álbumes |
| PUT | `/api/artistas/:id/generos` | Admin | `{ generoIds: [] }` (hasta 10) | **204**. Reemplaza la lista. 404, 400 si algún género no existe |

### Álbumes

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/albumes/:id` | Sí | | **200** `{ id, nombre, fecha_lanzamiento, duracion, artista: { id, nombre }, canciones: [{ id, nombre, duracion }] }`. 404 |
| POST | `/api/albumes` | Admin | `{ nombre, artistaId, fechaLanzamiento? }` (fecha `YYYY-MM-DD` o `null`) | **201** `{ id, nombre, artista_id, fecha_lanzamiento }`. 400 si el artista no existe, 409 si el artista ya tiene un álbum con ese nombre |
| PATCH | `/api/albumes/:id` | Admin | `{ nombre?, fechaLanzamiento? }` (al menos uno) | **200** igual que POST. 404, 409 |
| DELETE | `/api/albumes/:id` | Admin | | **204**. 404, 409 si tiene canciones |

### Canciones

Todas las respuestas de canción tienen esta forma:
`{ id, nombre, duracion, spotify_uri, itunes_id, portada_url, artista: { id, nombre }, album: { id, nombre } | null }`.

| Método | Ruta | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| GET | `/api/canciones` | Sí | `page`, `limit`, `q` (busca en canción y artista), `artistaId` | **200** paginado de canciones |
| GET | `/api/canciones/:id` | Sí | | **200** canción. 404 |
| POST | `/api/canciones` | Admin | `{ nombre, artistaId, albumId?, duracionSegundos? }` | **201** canción. 400 si el artista o el álbum no existen, 409 si el artista ya tiene una canción con ese nombre |
| POST | `/api/canciones/resolver` | Sí | `{ nombre, artista, album?, duracionSegundos?, itunesId?, portadaUrl? }` (`portadaUrl` solo `https` de `*.mzstatic.com`) | **200** canción del catálogo. La crea (con su artista y álbum) si no existía y, si ya existía, solo completa los datos que le faltaban. 429 si el usuario pasa de 60 pedidos en 15 minutos |
| PATCH | `/api/canciones/:id` | Admin | `{ nombre?, artistaId?, albumId?, duracionSegundos? }` (al menos uno; `albumId` y `duracionSegundos` aceptan `null`) | **200** canción. 404, 409 |
| DELETE | `/api/canciones/:id` | Admin | | **204**. 404, 409 si tiene reproducciones |
