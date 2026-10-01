export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Clamps untrusted page/limit query values into a safe window. */
export function parsePage(page?: number | string, limit?: number | string): PageRequest {
  const pageNumber = Math.max(1, Number.parseInt(String(page ?? 1), 10) || 1);
  const rawLimit = Number.parseInt(String(limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page: pageNumber, limit: pageSize, skip: (pageNumber - 1) * pageSize };
}

export function toPaginated<T>(items: T[], total: number, request: PageRequest): PaginatedResult<T> {
  return { items, total, page: request.page, limit: request.limit };
}
