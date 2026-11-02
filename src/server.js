import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = app.listen(config.PORT, () => {
  console.log(`API escuchando en http://localhost:${config.PORT}`);
});

// Cierre prolijo: deja terminar las requests en curso y cierra el pool de PostgreSQL
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
