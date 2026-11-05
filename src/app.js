import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { query } from './db.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { authRouter, meRouter } from './controllers/auth.js';
import { bibliotecaRouter } from './controllers/biblioteca.js';
import { catalogoRouter } from './controllers/catalogo.js';
import { historialRouter } from './controllers/historial.js';
import { wrappedRouter } from './controllers/wrapped.js';

// app separado de server.js para poder testearlo con supertest sin abrir un puerto.
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de un proxy (Render, Railway...) para que el rate limit vea la IP real

// Orden de los middlewares: seguridad -> CORS -> logs -> parseo de body y cookies -> rutas -> errores
app.use(helmet());
// credentials: el front manda la cookie de sesión. Exige una lista de orígenes, nunca "*".
app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
if (config.NODE_ENV !== 'test') app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Todas las rutas cuelgan de /api
const api = express.Router();

api.get('/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

api.use('/auth', authRouter);
api.use('/me', meRouter);
api.use('/me', bibliotecaRouter);  // /me/playlists, /me/favoritos
api.use('/me', historialRouter);   // /me/reproducciones, /me/importaciones
api.use('/me/wrapped', wrappedRouter);
api.use('/', catalogoRouter);      // /generos, /artistas, /albumes, /canciones

app.use('/api', api);

app.use(notFoundHandler);
app.use(errorHandler);
