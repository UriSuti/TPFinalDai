// Uso: npm run admin -- usuario@mail.com
// No hay endpoint para volverse admin (sería un agujero): se hace desde la consola.
import { pool } from '../src/db.js';

const email = process.argv[2];
if (!email) {
  console.error('Uso: npm run admin -- usuario@mail.com');
  process.exit(1);
}

const { rowCount } = await pool.query(
  "UPDATE public.usuarios SET rol = 'admin' WHERE lower(email) = lower($1)",
  [email],
);
console.log(rowCount ? `${email} ahora es admin` : `No existe un usuario con email ${email}`);
await pool.end();
