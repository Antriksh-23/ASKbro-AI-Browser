import { z } from 'zod';

export const SkillWorkflowTypeEnum = z.enum([
  'summary',
  'explanation',
  'reply',
  'fill_profile',
  'custom',
]);

export type SkillWorkflowType = z.infer<typeof SkillWorkflowTypeEnum>;

/**
 * Zod schema for runtime validation of a single Skill Definition
 */
export const SkillDefinitionSchema = z.object({
  id: z.string().min(1, 'Skill ID is required'),
  name: z.string().min(1, 'Skill name is required').max(80, 'Skill name must be under 80 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(280, 'Description must be under 280 characters'),
  systemPrompt: z.string().min(10, 'System prompt must be at least 10 characters long'),
  actionWorkflow: SkillWorkflowTypeEnum.default('summary'),
  isBuiltIn: z.boolean().default(false),
  icon: z.string().optional().default('Sparkles'),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/**
 * Portable JSON Export / Import Bundle Schema
 */
export const SkillExportBundleSchema = z.object({
  version: z.string().default('1.0.0'),
  generator: z.string().default('ASKbro AI Browser'),
  exportedAt: z.string(),
  skills: z.array(SkillDefinitionSchema).min(1, 'Export bundle must contain at least one skill'),
});

export type SkillExportBundle = z.infer<typeof SkillExportBundleSchema>;

/**
 * Result structure returned after skill execution
 */
export interface SkillExecutionResult {
  skillId: string;
  skillName: string;
  workflow: string;
  content: string;
  completedAt: string;
  provider?: string;
  model?: string;
}

