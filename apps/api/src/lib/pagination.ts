import type { Paginated, Pagination } from "@loadtopia/shared";

/** Convert `{ page, pageSize }` into Prisma `{ skip, take }`. */
export function toSkipTake(p: Pagination): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paginate<T>(data: T[], total: number, p: Pagination): Paginated<T> {
  return {
    data,
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}
