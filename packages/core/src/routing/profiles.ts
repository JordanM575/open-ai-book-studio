import { z } from "zod";

/**
 * What one writing task needs from a model, as data. Profiles are author-selected; the studio
 * never infers a task from prompts, manuscript text, history or tool output. No profile shipped
 * here is settled policy: the initial taxonomy and its evidence stay with the unresolved public
 * decisions, so this module defines the shape only and tests use local fixtures.
 */
export const taskRequirementsSchema = z.object({
  requiresTools: z.boolean(),
  requiresImages: z.boolean().optional(),
  minContextLength: z.number().int().positive().nullable().optional()
});
export type TaskRequirements = z.infer<typeof taskRequirementsSchema>;

export const taskProfileSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  purpose: z.string().min(1).max(2000),
  version: z.number().int().positive(),
  requirements: taskRequirementsSchema
});
export type TaskProfile = z.infer<typeof taskProfileSchema>;
