/**
 * @file packages/shared/src/types/tasks.ts
 * @node 03.03
 * @description Task coordination types.
 */
import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  task_type: z.string(),
  depends_on: z.array(z.string().uuid()),
  status: TaskStatusSchema,
  input_snapshot: z.unknown(),
  output: z.unknown().nullable(),
  attempt_count: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  started_at: z.coerce.date().nullable(),
  completed_at: z.coerce.date().nullable(),
  deadline_at: z.coerce.date().nullable(),
  error_message: z.string().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type Task = z.infer<typeof TaskSchema>;
