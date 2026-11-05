import 'dotenv/config';
import { z } from 'zod';

// Valida las variables de entorno al arrancar: si falta algo, el server no levanta.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // En el navegador la sesión dura lo que dura este JWT (no se renueva sola)
  JWT_ACCESS_TTL: z.string().default('2h'),
  // strict sirve con front y back en el mismo sitio (localhost:5173 y localhost:3000 lo son).
  // Con dominios distintos en producción: none (fuerza Secure).
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  REFRESH_TTL_DIAS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LASTFM_API_KEY: z.string().optional(),
  LASTFM_BASE_URL: z.string().url().default('https://ws.audioscrobbler.com/2.0/'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
