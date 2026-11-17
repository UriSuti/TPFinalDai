import * as actividadRepository from '../repositories/actividad.js';
import { offset, paginated } from '../utils/pagination.js';

// tipo filtra por prefijo: 'resena' trae resena_crear, resena_editar y resena_borrar.
export async function listarActividad(usuarioId, { tipo, ...p }) {
  const [rows, total] = await Promise.all([
    actividadRepository.listar(usuarioId, { tipo, limit: p.limit, offset: offset(p) }),
    actividadRepository.contar(usuarioId, tipo),
  ]);
  return paginated(rows, p, total);
}
