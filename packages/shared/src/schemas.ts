import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.string(),
  statusCode: z.number().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
