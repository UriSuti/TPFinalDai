import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { limitarPorUsuario } from '../src/middlewares/rateLimit.js';

// App mínima: el "usuario" sale del header x-user, como si requireAuth ya hubiera corrido.
function crearApp(limit) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: Number(req.get('x-user')) };
    next();
  });
  app.post('/accion', limitarPorUsuario({ windowMs: 60_000, limit, skip: () => false }), (_req, res) => {
    res.json({ ok: true });
  });
  return supertest(app);
}

describe('límite por usuario', () => {
  test('pasado el límite responde 429 con mensaje claro', async () => {
    const app = crearApp(3);
    for (let i = 0; i < 3; i++) await app.post('/accion').set('x-user', '1').expect(200);

    const res = await app.post('/accion').set('x-user', '1').expect(429);
    assert.match(res.body.error, /Demasiadas solicitudes/);
  });

  test('el límite es por usuario: otro usuario sigue pudiendo', async () => {
    const app = crearApp(2);
    await app.post('/accion').set('x-user', '1').expect(200);
    await app.post('/accion').set('x-user', '1').expect(200);
    await app.post('/accion').set('x-user', '1').expect(429);

    await app.post('/accion').set('x-user', '2').expect(200);
  });
});
