import { badRequest } from '../utils/errors.js';

// validate({ body, query, params }) con esquemas zod.
// Lo validado (ya convertido y con defaults) queda en req.valid.body / .query / .params.
// En Express 5 req.query es de solo lectura, por eso no se pisa.
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  const errores = [];

  for (const parte of ['params', 'query', 'body']) {
    if (!schemas[parte]) continue;
    const result = schemas[parte].safeParse(req[parte] ?? {});
    if (result.success) {
      req.valid[parte] = result.data;
    } else {
      for (const issue of result.error.issues) {
        errores.push({ campo: [parte, ...issue.path].join('.'), mensaje: issue.message });
      }
    }
  }

  if (errores.length) throw badRequest('Datos inválidos', errores);
  next();
};
