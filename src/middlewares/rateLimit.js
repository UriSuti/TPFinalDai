import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const enTest = () => config.NODE_ENV === 'test';

// Frena fuerza bruta sobre login/registro: 20 intentos cada 15 minutos por IP.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: enTest,
  message: { error: 'Demasiados intentos, probá de nuevo en unos minutos' },
});

// Límite por usuario logueado (no por IP). Usar siempre después de requireAuth.
// `skip` se puede pisar: los tests de este middleware lo activan aunque NODE_ENV sea "test".
export const limitarPorUsuario = ({ windowMs, limit, skip = enTest }) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => String(req.user.id),
  message: { error: 'Demasiadas solicitudes, probá de nuevo en unos minutos' },
});

// POST /canciones/resolver crea artistas, álbumes y canciones en el catálogo compartido:
// 60 altas cada 15 minutos por usuario alcanzan para el uso normal y frenan el abuso.
export const resolverLimiter = limitarPorUsuario({ windowMs: 15 * 60 * 1000, limit: 60 });
