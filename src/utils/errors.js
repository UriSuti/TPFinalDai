// Error "esperado": el errorHandler lo convierte en una respuesta con su status.
export class AppError extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export const badRequest = (msg, detalles) => new AppError(400, msg, detalles);
export const unauthorized = (msg = 'No autenticado') => new AppError(401, msg);
export const forbidden = (msg = 'No tenés permiso para esta acción') => new AppError(403, msg);
export const notFound = (msg = 'Recurso no encontrado') => new AppError(404, msg);
export const conflict = (msg) => new AppError(409, msg);
export const badGateway = (msg) => new AppError(502, msg);
