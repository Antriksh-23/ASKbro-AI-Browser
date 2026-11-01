import { z } from 'zod';

export {
  ActionTypeEnum,
  type ActionType,
  ActionStepSchema,
  type ActionStep,
  NextActionSchema,
  type NextAction,
  ActionPlanSchema,
  type ActionPlan,
  ActionExecutionStatusSchema,
  type ActionExecutionStatus,
  ActionHistoryEntrySchema,
  type ActionHistoryEntry,
  ActionAuditLogEntrySchema,
  type ActionAuditLogEntry,
  AgentTaskSessionSchema,
  type AgentTaskSession,
} from '../services/ai/schemas';

export interface ActionableElement {
  id: number;
  tag: string;
  type?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  name?: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  disabled?: boolean;
  role?: string;
  value?: string;
  href?: string;
}

export type ActionMap = ActionableElement[];

/**
 * Clean, compact representation of an actionable element for LLM consumption (Slice 3.2)
 * Strips verbose bounding rects and unneeded attributes to conserve prompt tokens.
 */
export interface CompactActionElement {
  id: number;
  type: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  name?: string;
  role?: string;
  value?: string;
  href?: string;
}

export const FindElementResultSchema = z.object({
  targetElementId: z.number().nullable(),
  reason: z.string(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export type FindElementResult = z.infer<typeof FindElementResultSchema>;


