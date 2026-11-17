// Carga db/schema.sql en la base de DATABASE_URL. No necesita psql instalado.
//
// Uso:  npm run db:init              (falla si la base ya tiene tablas)
//       npm run db:init -- --reset   (BORRA TODO el esquema public y lo vuelve a crear)
import fs from 'node:fs';
import { pool } from '../src/db.js';

const reset = process.argv.includes('--reset');
const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

const client = await pool.connect();
try {
  const { rows } = await client.query(
    "SELECT count(*) AS tablas FROM information_schema.tables WHERE table_schema = 'public'",
  );
  if (rows[0].tablas > 0 && !reset) {
    console.error('La base ya tiene tablas. Para borrarla y crearla de nuevo: npm run db:init -- --reset');
    process.exitCode = 1;
  } else {
    if (reset) await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await client.query(sql);
    console.log('Esquema cargado.');
  }
} catch (err) {
  console.error('No se pudo cargar el esquema:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
