import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

// Frena fuerza bruta sobre login/registro: 20 intentos cada 15 minutos por IP.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  message: { error: 'Demasiados intentos, probá de nuevo en unos minutos' },
});
