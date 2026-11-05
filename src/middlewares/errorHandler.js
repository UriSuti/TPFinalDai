import multer from 'multer';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No existe ${req.method} ${req.path}` });
}

// Traduce errores de PostgreSQL a respuestas HTTP. Así las constraints del esquema
// (UNIQUE, FK, CHECK) son la última línea de defensa y el cliente recibe un 4xx claro.
function desdePostgres(err) {
  switch (err.code) {
    case '23505':
      return new AppError(409, 'Ya existe un registro con esos datos', { constraint: err.constraint });
    case '23503':
      return err.detail?.includes('is still referenced')
        ? new AppError(409, 'No se puede borrar: hay otros datos que lo usan', { constraint: err.constraint })
        : new AppError(400, 'Referencia a un recurso que no existe', { constraint: err.constraint });
    case '23514':
      return new AppError(400, 'Los datos no cumplen una regla del modelo', { constraint: err.constraint });
    case '22P02':
    case '22007':
    case '22008':
      return new AppError(400, 'Formato de dato inválido');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err instanceof AppError ? err : desdePostgres(err);

  if (!error && err instanceof multer.MulterError) {
    error = new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, `Error al subir archivos: ${err.message}`);
  }
  if (!error && err.type === 'entity.parse.failed') error = new AppError(400, 'El body no es JSON válido');
  if (!error && err.type === 'entity.too.large') error = new AppError(413, 'El body es demasiado grande');

  if (!error) {
    console.error(err);
    const mensaje = config.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message;
    return res.status(500).json({ error: mensaje });
  }

  const body = { error: error.message };
  if (error.detalles) body.detalles = error.detalles;
  if (error.codigo) body.codigo = error.codigo;
  res.status(error.status).json(body);
}
