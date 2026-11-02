import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const offset = ({ page, limit }) => (page - 1) * limit;

// Formato común para todas las respuestas paginadas.
export function paginated(rows, { page, limit }, total) {
  return { data: rows, page, limit, total, totalPages: Math.ceil(total / limit) };
}
