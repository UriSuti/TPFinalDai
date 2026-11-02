import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { query } from './db.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { authRouter, meRouter } from './routes/auth.js';
import { bibliotecaRouter } from './routes/biblioteca.js';
import { catalogoRouter } from './routes/catalogo.js';
import { historialRouter } from './routes/historial.js';
import { wrappedRouter } from './routes/wrapped.js';

// app separado de server.js para poder testearlo con supertest sin abrir un puerto.
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de un proxy (Render, Railway...) para que el rate limit vea la IP real

// Orden de los middlewares: seguridad -> CORS -> logs -> parseo del body -> rutas -> errores
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
if (config.NODE_ENV !== 'test') app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

app.use('/auth', authRouter);
app.use('/me', meRouter);
app.use('/me', bibliotecaRouter);  // /me/playlists, /me/favoritos
app.use('/me', historialRouter);   // /me/reproducciones, /me/importaciones
app.use('/me/wrapped', wrappedRouter);
app.use('/', catalogoRouter);      // /generos, /artistas, /albumes, /canciones

app.use(notFoundHandler);
app.use(errorHandler);
