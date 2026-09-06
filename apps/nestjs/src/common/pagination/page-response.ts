export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export function pageResponse<T>(
  content: T[],
  page: number,
  size: number,
  totalElements: number,
): PageResponse<T> {
  return {
    content,
    page,
    size,
    totalElements,
    totalPages: Math.ceil(totalElements / size),
  };
}
