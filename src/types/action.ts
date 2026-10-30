import { z } from 'zod';

export const ActionStepSchema = z.object({
  action: z.enum(['click', 'type', 'select', 'scroll', 'done']),
  targetElementId: z.number().nullable(),
  value: z.string().nullable(),
  reason: z.string(),
  isConsequential: z.boolean(),
});

export type ActionStep = z.infer<typeof ActionStepSchema>;

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
}

export type ActionMap = ActionableElement[];
