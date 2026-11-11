--
-- PostgreSQL — Spotify Wrapped v5 (esquema para el backend)
--
-- Restaurar sobre una base VACÍA. Requiere PostgreSQL 12+.
--
-- Cambios respecto de la v4 (motivo: lo que necesita el front):
--   * NUEVAS tablas: biblioteca (estado de cada canción para el usuario) y resenas
--     (puntuación y comentario).
--   * canciones.itunes_id y canciones.portada_url: datos de la API externa con la que se
--     explora el catálogo. Opcionales: lo importado de Spotify o Last.fm no los trae.
--
-- Cambios de la v4 respecto de la v3 (motivo: lo que traen de verdad las fuentes externas):
--   * canciones.duracion y canciones.album_id pasan a ser opcionales: ni el export de
--     Spotify ni Last.fm traen la duración de la canción, y Last.fm a veces no trae álbum.
--   * Deduplicación por clave natural: artista por nombre, álbum por (artista, nombre),
--     canción por (artista, nombre). El export no trae URI de artista ni de álbum, y la
--     misma canción tiene varias URIs (single, álbum, remaster): para el Wrapped se unifican.
--     canciones.spotify_uri queda como dato informativo (no único).
--   * reproducciones.ms_reproducidos opcional (Last.fm no lo trae) + columna fuente.
--   * NUEVAS tablas: importaciones (cada archivo/sync importado) y refresh_tokens (JWT).
--   * usuarios: rol (usuario/admin) y usuario de Last.fm.
--   * artistas.generos_sincronizados_en: marca qué artistas ya se enriquecieron con Last.fm.
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TABLAS
--

CREATE TABLE public.generos (
    id integer GENERATED ALWAYS AS IDENTITY,
    nombre character varying NOT NULL
);

ALTER TABLE public.generos OWNER TO postgres;


CREATE TABLE public.artistas (
    id integer GENERATED ALWAYS AS IDENTITY,
    nombre character varying NOT NULL,
    generos_sincronizados_en timestamp with time zone
);

ALTER TABLE public.artistas OWNER TO postgres;


CREATE TABLE public.artistas_generos (
    artista_id integer NOT NULL,
    genero_id integer NOT NULL
);

ALTER TABLE public.artistas_generos OWNER TO postgres;


CREATE TABLE public.usuarios (
    id integer GENERATED ALWAYS AS IDENTITY,
    nombre character varying NOT NULL,
    apellido character varying NOT NULL,
    email character varying NOT NULL,
    password_hash character varying NOT NULL,
    rol character varying DEFAULT 'usuario' NOT NULL,
    lastfm_usuario character varying,
    avatar_url character varying,
    bio text,
    generos_preferidos jsonb DEFAULT '[]'::jsonb NOT NULL,
    artistas_preferidos jsonb DEFAULT '[]'::jsonb NOT NULL,
    fecha_registro timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.usuarios OWNER TO postgres;


--
-- Un álbum es una playlist con es_album = true: tiene artista y no tiene usuario.
-- Una playlist de usuario es al revés: tiene usuario y no tiene artista.
--
CREATE TABLE public.playlists (
    id integer GENERATED ALWAYS AS IDENTITY,
    nombre character varying NOT NULL,
    es_album boolean DEFAULT false NOT NULL,
    usuario_id integer,
    artista_id integer,
    fecha_lanzamiento date,
    fecha_creacion timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.playlists OWNER TO postgres;


--
-- album_es_album vale siempre true: la FK compuesta solo acepta playlists que sean álbumes.
-- Si album_id es NULL la FK no se controla (MATCH SIMPLE), que es lo que queremos.
--
CREATE TABLE public.canciones (
    id integer GENERATED ALWAYS AS IDENTITY,
    nombre character varying NOT NULL,
    duracion interval,
    artista_id integer NOT NULL,
    album_id integer,
    album_es_album boolean GENERATED ALWAYS AS (true) STORED NOT NULL,
    spotify_uri character varying,
    itunes_id bigint,
    portada_url character varying
);

ALTER TABLE public.canciones OWNER TO postgres;


CREATE TABLE public.canciones_playlists (
    playlist_id integer NOT NULL,
    cancion_id integer NOT NULL,
    playlist_es_album boolean GENERATED ALWAYS AS (false) STORED NOT NULL,
    fecha_agregada timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.canciones_playlists OWNER TO postgres;


CREATE TABLE public.favoritos (
    usuario_id integer NOT NULL,
    cancion_id integer NOT NULL,
    fecha_agregada timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.favoritos OWNER TO postgres;


--
-- Estado de cada canción para el usuario. Es independiente de favoritos: una canción
-- puede estar "escuchada" y además ser favorita.
--
CREATE TABLE public.biblioteca (
    usuario_id integer NOT NULL,
    cancion_id integer NOT NULL,
    estado character varying NOT NULL,
    fecha_agregada timestamp with time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.biblioteca OWNER TO postgres;


--
-- Una reseña por usuario y canción. Puede tener solo puntuación, solo comentario o ambos.
--
CREATE TABLE public.resenas (
    usuario_id integer NOT NULL,
    cancion_id integer NOT NULL,
    puntuacion smallint,
    comentario character varying,
    fecha_creacion timestamp with time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.resenas OWNER TO postgres;


--
-- Una fila por archivo de Spotify subido o por sincronización con Last.fm.
-- Borrar una importación borra sus reproducciones (sirve para "deshacer").
--
CREATE TABLE public.importaciones (
    id integer GENERATED ALWAYS AS IDENTITY,
    usuario_id integer NOT NULL,
    fuente character varying NOT NULL,
    detalle character varying,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    filas_leidas integer DEFAULT 0 NOT NULL,
    filas_insertadas integer DEFAULT 0 NOT NULL,
    filas_descartadas integer DEFAULT 0 NOT NULL
);

ALTER TABLE public.importaciones OWNER TO postgres;


--
-- Historial de escucha. fecha_hora en UTC (timestamptz).
--   Spotify:  ts -> fecha_hora, ms_played -> ms_reproducidos, platform, shuffle, skipped.
--   Last.fm:  date.uts -> fecha_hora; no trae ms (un scrobble ya implica escucha real).
--
CREATE TABLE public.reproducciones (
    id bigint GENERATED ALWAYS AS IDENTITY,
    usuario_id integer NOT NULL,
    cancion_id integer NOT NULL,
    importacion_id integer,
    fuente character varying NOT NULL,
    fecha_hora timestamp with time zone NOT NULL,
    ms_reproducidos integer,
    plataforma character varying,
    aleatorio boolean,
    salteada boolean
);

ALTER TABLE public.reproducciones OWNER TO postgres;


--
-- Refresh tokens opacos. Se guarda solo el hash SHA-256, nunca el token.
-- Rotación: cada /auth/refresh revoca el token usado y emite uno nuevo.
--
CREATE TABLE public.refresh_tokens (
    id integer GENERATED ALWAYS AS IDENTITY,
    usuario_id integer NOT NULL,
    token_hash character varying NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    expira_en timestamp with time zone NOT NULL,
    revocado_en timestamp with time zone
);

ALTER TABLE public.refresh_tokens OWNER TO postgres;


--
-- PUNTUACIONES
--

CREATE TABLE public.puntuaciones (
    usuario_id integer NOT NULL,
    tipo character varying NOT NULL,
    item_id integer NOT NULL,
    puntuacion integer NOT NULL,
    comentario text,
    fecha_creacion timestamp with time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.puntuaciones OWNER TO postgres;

ALTER TABLE ONLY public.puntuaciones
    ADD CONSTRAINT puntuaciones_pk PRIMARY KEY (usuario_id, tipo, item_id);
ALTER TABLE public.puntuaciones
    ADD CONSTRAINT puntuaciones_tipo_ck CHECK (tipo IN ('cancion', 'album'));
ALTER TABLE public.puntuaciones
    ADD CONSTRAINT puntuaciones_puntuacion_ck CHECK (puntuacion BETWEEN 1 AND 5);
ALTER TABLE public.puntuaciones
    ADD CONSTRAINT puntuaciones_comentario_ck CHECK (comentario IS NULL OR length(trim(comentario)) > 0);

ALTER TABLE ONLY public.puntuaciones
    ADD CONSTRAINT puntuaciones_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;

CREATE INDEX puntuaciones_tipo_item_idx ON public.puntuaciones USING btree (tipo, item_id);


--
-- PRIMARY KEYS, UNIQUE y CHECK
--

ALTER TABLE ONLY public.generos
    ADD CONSTRAINT generos_pk PRIMARY KEY (id);
ALTER TABLE public.generos
    ADD CONSTRAINT generos_nombre_ck CHECK (btrim(nombre) <> '');
CREATE UNIQUE INDEX generos_nombre_uq ON public.generos USING btree (lower(nombre));


ALTER TABLE ONLY public.artistas
    ADD CONSTRAINT artistas_pk PRIMARY KEY (id);
ALTER TABLE public.artistas
    ADD CONSTRAINT artistas_nombre_ck CHECK (btrim(nombre) <> '');
CREATE UNIQUE INDEX artistas_nombre_uq ON public.artistas USING btree (lower(nombre));


ALTER TABLE ONLY public.artistas_generos
    ADD CONSTRAINT artistas_generos_pk PRIMARY KEY (artista_id, genero_id);


ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pk PRIMARY KEY (id);
ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_nombre_ck CHECK (btrim(nombre) <> '' AND btrim(apellido) <> '');
ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_email_ck CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_rol_ck CHECK (rol IN ('usuario', 'admin'));
CREATE UNIQUE INDEX usuarios_email_uq ON public.usuarios USING btree (lower(email));


ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_pk PRIMARY KEY (id);
-- Necesaria para que canciones y canciones_playlists puedan referenciar (id, es_album)
ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_id_es_album_uq UNIQUE (id, es_album);
ALTER TABLE public.playlists
    ADD CONSTRAINT playlists_tipo_ck CHECK (
        (es_album AND artista_id IS NOT NULL AND usuario_id IS NULL)
        OR
        (NOT es_album AND usuario_id IS NOT NULL AND artista_id IS NULL
         AND fecha_lanzamiento IS NULL)
    );
ALTER TABLE public.playlists
    ADD CONSTRAINT playlists_nombre_ck CHECK (btrim(nombre) <> '');
-- Un artista no puede tener dos álbumes con el mismo nombre (clave para importar)
CREATE UNIQUE INDEX playlists_album_uq ON public.playlists USING btree (artista_id, lower(nombre))
    WHERE es_album;


ALTER TABLE ONLY public.canciones
    ADD CONSTRAINT canciones_pk PRIMARY KEY (id);
ALTER TABLE public.canciones
    ADD CONSTRAINT canciones_duracion_ck CHECK (
        duracion IS NULL OR (duracion > '00:00:00'::interval AND duracion < '24:00:00'::interval)
    );
ALTER TABLE public.canciones
    ADD CONSTRAINT canciones_nombre_ck CHECK (btrim(nombre) <> '');
CREATE UNIQUE INDEX canciones_artista_nombre_uq ON public.canciones USING btree (artista_id, lower(nombre));


ALTER TABLE ONLY public.canciones_playlists
    ADD CONSTRAINT canciones_playlists_pk PRIMARY KEY (playlist_id, cancion_id);


ALTER TABLE ONLY public.favoritos
    ADD CONSTRAINT favoritos_pk PRIMARY KEY (usuario_id, cancion_id);


ALTER TABLE ONLY public.biblioteca
    ADD CONSTRAINT biblioteca_pk PRIMARY KEY (usuario_id, cancion_id);
ALTER TABLE public.biblioteca
    ADD CONSTRAINT biblioteca_estado_ck CHECK (estado IN ('quiero_escuchar', 'escuchando', 'escuchado'));


ALTER TABLE ONLY public.resenas
    ADD CONSTRAINT resenas_pk PRIMARY KEY (usuario_id, cancion_id);
ALTER TABLE public.resenas
    ADD CONSTRAINT resenas_puntuacion_ck CHECK (puntuacion BETWEEN 1 AND 5);
ALTER TABLE public.resenas
    ADD CONSTRAINT resenas_contenido_ck CHECK (
        puntuacion IS NOT NULL OR (comentario IS NOT NULL AND btrim(comentario) <> '')
    );


ALTER TABLE ONLY public.importaciones
    ADD CONSTRAINT importaciones_pk PRIMARY KEY (id);
ALTER TABLE public.importaciones
    ADD CONSTRAINT importaciones_fuente_ck CHECK (fuente IN ('spotify', 'lastfm'));


ALTER TABLE ONLY public.reproducciones
    ADD CONSTRAINT reproducciones_pk PRIMARY KEY (id);
-- Evita duplicar el historial si se importa dos veces el mismo archivo
ALTER TABLE ONLY public.reproducciones
    ADD CONSTRAINT reproducciones_uq UNIQUE (usuario_id, fecha_hora, cancion_id);
ALTER TABLE public.reproducciones
    ADD CONSTRAINT reproducciones_ms_ck CHECK (ms_reproducidos IS NULL OR ms_reproducidos >= 0);
ALTER TABLE public.reproducciones
    ADD CONSTRAINT reproducciones_fuente_ck CHECK (fuente IN ('spotify', 'lastfm', 'manual'));


ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pk PRIMARY KEY (id);
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_hash_uq UNIQUE (token_hash);


--
-- FOREIGN KEYS
-- RESTRICT en el catálogo (géneros, artistas, álbumes): no se borra nada por accidente.
-- CASCADE en lo que es del usuario y en las tablas intermedias.
-- reproducciones -> canciones es RESTRICT: borrar una canción no debe borrar
-- en silencio el historial que alimenta las estadísticas.
--

ALTER TABLE ONLY public.artistas_generos
    ADD CONSTRAINT artistas_generos_artistas_fk FOREIGN KEY (artista_id)
    REFERENCES public.artistas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.artistas_generos
    ADD CONSTRAINT artistas_generos_generos_fk FOREIGN KEY (genero_id)
    REFERENCES public.generos(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_artistas_fk FOREIGN KEY (artista_id)
    REFERENCES public.artistas(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.canciones
    ADD CONSTRAINT canciones_artistas_fk FOREIGN KEY (artista_id)
    REFERENCES public.artistas(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.canciones
    ADD CONSTRAINT canciones_albumes_fk FOREIGN KEY (album_id, album_es_album)
    REFERENCES public.playlists(id, es_album) ON DELETE RESTRICT;

ALTER TABLE ONLY public.canciones_playlists
    ADD CONSTRAINT canciones_playlists_playlists_fk FOREIGN KEY (playlist_id, playlist_es_album)
    REFERENCES public.playlists(id, es_album) ON DELETE CASCADE;
ALTER TABLE ONLY public.canciones_playlists
    ADD CONSTRAINT canciones_playlists_canciones_fk FOREIGN KEY (cancion_id)
    REFERENCES public.canciones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.favoritos
    ADD CONSTRAINT favoritos_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.favoritos
    ADD CONSTRAINT favoritos_canciones_fk FOREIGN KEY (cancion_id)
    REFERENCES public.canciones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.biblioteca
    ADD CONSTRAINT biblioteca_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.biblioteca
    ADD CONSTRAINT biblioteca_canciones_fk FOREIGN KEY (cancion_id)
    REFERENCES public.canciones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resenas
    ADD CONSTRAINT resenas_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.resenas
    ADD CONSTRAINT resenas_canciones_fk FOREIGN KEY (cancion_id)
    REFERENCES public.canciones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.importaciones
    ADD CONSTRAINT importaciones_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reproducciones
    ADD CONSTRAINT reproducciones_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reproducciones
    ADD CONSTRAINT reproducciones_canciones_fk FOREIGN KEY (cancion_id)
    REFERENCES public.canciones(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.reproducciones
    ADD CONSTRAINT reproducciones_importaciones_fk FOREIGN KEY (importacion_id)
    REFERENCES public.importaciones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_usuarios_fk FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- ÍNDICES en columnas de FK y búsquedas frecuentes
-- (las columnas que encabezan una PK o UNIQUE ya están indexadas)
--

CREATE INDEX artistas_generos_genero_id_idx ON public.artistas_generos USING btree (genero_id);
CREATE INDEX playlists_usuario_id_idx ON public.playlists USING btree (usuario_id);
CREATE INDEX canciones_album_id_idx ON public.canciones USING btree (album_id);
CREATE INDEX canciones_spotify_uri_idx ON public.canciones USING btree (spotify_uri);
CREATE INDEX canciones_playlists_cancion_id_idx ON public.canciones_playlists USING btree (cancion_id);
CREATE INDEX favoritos_cancion_id_idx ON public.favoritos USING btree (cancion_id);
CREATE INDEX biblioteca_cancion_id_idx ON public.biblioteca USING btree (cancion_id);
CREATE INDEX resenas_cancion_id_idx ON public.resenas USING btree (cancion_id);
CREATE INDEX importaciones_usuario_id_idx ON public.importaciones USING btree (usuario_id);
-- reproducciones_uq (usuario_id, fecha_hora, cancion_id) ya sirve para filtrar por usuario y rango de fechas
CREATE INDEX reproducciones_cancion_id_idx ON public.reproducciones USING btree (cancion_id);
CREATE INDEX reproducciones_importacion_id_idx ON public.reproducciones USING btree (importacion_id);
CREATE INDEX refresh_tokens_usuario_id_idx ON public.refresh_tokens USING btree (usuario_id);
CREATE INDEX puntuaciones_tipo_item_idx ON public.puntuaciones USING btree (tipo, item_id);


--
-- VISTAS
--

-- Duración de álbumes y playlists. Canciones sin duración conocida no suman.
CREATE VIEW public.playlists_duracion AS
 SELECT p.id,
    p.nombre,
    p.es_album,
    COALESCE(
        CASE
            WHEN p.es_album THEN ( SELECT sum(c.duracion) AS sum
               FROM public.canciones c
              WHERE (c.album_id = p.id))
            ELSE ( SELECT sum(c.duracion) AS sum
               FROM (public.canciones_playlists cp
                 JOIN public.canciones c ON ((c.id = cp.cancion_id)))
              WHERE (cp.playlist_id = p.id))
        END, '00:00:00'::interval) AS duracion
   FROM public.playlists p;

ALTER VIEW public.playlists_duracion OWNER TO postgres;


--
-- Base de las vistas wrapped_*:
--   * fecha en hora de Buenos Aires (Spotify y Last.fm exportan en UTC).
--   * es_stream: criterio de Spotify (30 s o más). Un scrobble de Last.fm siempre cuenta.
--   * ms_efectivos: lo reproducido; si no se sabe (Last.fm), la duración de la canción;
--     si tampoco se sabe, 210000 ms (3:30, duración promedio). Es una ESTIMACIÓN.
--
CREATE VIEW public.reproducciones_local AS
 SELECT r.id,
    r.usuario_id,
    r.cancion_id,
    c.artista_id,
    r.fuente,
    (r.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires') AS fecha_hora_local,
    (EXTRACT(year FROM (r.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')))::integer AS anio,
    (COALESCE((r.ms_reproducidos)::numeric,
              (EXTRACT(epoch FROM c.duracion) * (1000)::numeric),
              (210000)::numeric))::bigint AS ms_efectivos,
    ((r.ms_reproducidos IS NULL) OR (r.ms_reproducidos >= 30000)) AS es_stream,
    r.salteada
   FROM (public.reproducciones r
     JOIN public.canciones c ON ((c.id = r.cancion_id)));

ALTER VIEW public.reproducciones_local OWNER TO postgres;


CREATE VIEW public.wrapped_resumen AS
 SELECT usuario_id,
    anio,
    (round(((sum(ms_efectivos))::numeric / 60000.0), 0))::integer AS minutos_escuchados,
    count(*) FILTER (WHERE es_stream) AS streams,
    count(DISTINCT cancion_id) FILTER (WHERE es_stream) AS canciones_distintas,
    count(DISTINCT artista_id) FILTER (WHERE es_stream) AS artistas_distintos
   FROM public.reproducciones_local
  GROUP BY usuario_id, anio;

ALTER VIEW public.wrapped_resumen OWNER TO postgres;


CREATE VIEW public.wrapped_top_canciones AS
 SELECT rl.usuario_id,
    rl.anio,
    rank() OVER (PARTITION BY rl.usuario_id, rl.anio
                 ORDER BY (count(*)) DESC, (sum(rl.ms_efectivos)) DESC) AS puesto,
    c.id AS cancion_id,
    c.nombre AS cancion,
    a.id AS artista_id,
    a.nombre AS artista,
    count(*) AS streams,
    (round(((sum(rl.ms_efectivos))::numeric / 60000.0), 0))::integer AS minutos
   FROM ((public.reproducciones_local rl
     JOIN public.canciones c ON ((c.id = rl.cancion_id)))
     JOIN public.artistas a ON ((a.id = c.artista_id)))
  WHERE rl.es_stream
  GROUP BY rl.usuario_id, rl.anio, c.id, c.nombre, a.id, a.nombre;

ALTER VIEW public.wrapped_top_canciones OWNER TO postgres;


-- Ranking por minutos (como Spotify Wrapped), desempata por streams.
CREATE VIEW public.wrapped_top_artistas AS
 SELECT rl.usuario_id,
    rl.anio,
    rank() OVER (PARTITION BY rl.usuario_id, rl.anio
                 ORDER BY (sum(rl.ms_efectivos)) DESC, (count(*)) DESC) AS puesto,
    a.id AS artista_id,
    a.nombre AS artista,
    count(*) AS streams,
    (round(((sum(rl.ms_efectivos))::numeric / 60000.0), 0))::integer AS minutos
   FROM (public.reproducciones_local rl
     JOIN public.artistas a ON ((a.id = rl.artista_id)))
  WHERE rl.es_stream
  GROUP BY rl.usuario_id, rl.anio, a.id, a.nombre;

ALTER VIEW public.wrapped_top_artistas OWNER TO postgres;


-- Un stream de un artista con 2 géneros suma a ambos: el porcentaje es sobre el
-- total de streams del año y la suma puede pasar de 100%.
-- El total sale de una subconsulta escalar (se ejecuta una vez por género del resultado).
-- No se hace JOIN contra wrapped_resumen: con estadísticas desactualizadas (justo después
-- de una importación grande) el planificador recalculaba ese agregado por cada fila.
CREATE VIEW public.wrapped_top_generos AS
 SELECT t.usuario_id,
    t.anio,
    rank() OVER (PARTITION BY t.usuario_id, t.anio ORDER BY t.streams DESC) AS puesto,
    t.genero_id,
    t.genero,
    t.streams,
    round(((100.0 * (t.streams)::numeric) / (NULLIF(( SELECT count(*) AS count
           FROM public.reproducciones r
          WHERE ((r.usuario_id = t.usuario_id)
            AND ((EXTRACT(year FROM (r.fecha_hora AT TIME ZONE 'America/Argentina/Buenos_Aires')))::integer = t.anio)
            AND ((r.ms_reproducidos IS NULL) OR (r.ms_reproducidos >= 30000)))), 0))::numeric), 1) AS porcentaje
   FROM ( SELECT rl.usuario_id,
            rl.anio,
            g.id AS genero_id,
            g.nombre AS genero,
            count(*) AS streams
           FROM ((public.reproducciones_local rl
             JOIN public.artistas_generos ag ON ((ag.artista_id = rl.artista_id)))
             JOIN public.generos g ON ((g.id = ag.genero_id)))
          WHERE rl.es_stream
          GROUP BY rl.usuario_id, rl.anio, g.id, g.nombre) t;

ALTER VIEW public.wrapped_top_generos OWNER TO postgres;


-- Hábitos: minutos por día de la semana (1 = lunes ... 7 = domingo) y hora (0-23).
CREATE VIEW public.wrapped_habitos AS
 SELECT usuario_id,
    anio,
    (EXTRACT(isodow FROM fecha_hora_local))::integer AS dia_semana,
    (EXTRACT(hour FROM fecha_hora_local))::integer AS hora,
    count(*) FILTER (WHERE es_stream) AS streams,
    (round(((sum(ms_efectivos))::numeric / 60000.0), 0))::integer AS minutos,
    count(*) FILTER (WHERE salteada) AS salteadas
   FROM public.reproducciones_local
  GROUP BY usuario_id, anio, (EXTRACT(isodow FROM fecha_hora_local)), (EXTRACT(hour FROM fecha_hora_local));

ALTER VIEW public.wrapped_habitos OWNER TO postgres;


--
-- PostgreSQL database dump complete
--
