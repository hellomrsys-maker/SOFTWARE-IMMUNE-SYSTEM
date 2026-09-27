/**
 * @file packages/shared/src/schemas/index.ts
 * @node 02.05.01, 11.01
 * @description Zod schema re-exports and API request/response schemas.
 */
import { z } from "zod";
export { z };

// node: 11.01 — Control API request schemas
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
