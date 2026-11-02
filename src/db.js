import pg from 'pg';
import { config } from './config.js';

// COUNT(*) y SUM devuelven bigint/numeric: pg los trae como string para no perder
// precisión. En este dominio los valores entran de sobra en un Number de JS.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

// Las duraciones (interval) se devuelven en segundos: más fácil de usar en el front que
// el objeto { minutes, seconds } que arma pg por defecto.
const parseInterval = pg.types.getTypeParser(pg.types.builtins.INTERVAL);
pg.types.setTypeParser(pg.types.builtins.INTERVAL, (v) => {
  const i = parseInterval(v);
  const seg = ((((i.days ?? 0) * 24 + (i.hours ?? 0)) * 60 + (i.minutes ?? 0)) * 60)
    + (i.seconds ?? 0) + (i.milliseconds ?? 0) / 1000;
  return Math.round(seg);
});

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const query = (text, params) => pool.query(text, params);

// Ejecuta fn(client) dentro de una transacción. Si fn tira error, hace ROLLBACK.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
