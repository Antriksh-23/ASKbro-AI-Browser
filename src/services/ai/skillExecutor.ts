/**
 * ASKbro One-Click Reusable Skills Execution Service (Slice 4.2)
 *
 * Implements:
 * - Injection-sanitized context wrapping for skill execution.
 * - Non-streaming and SSE streaming skill generation with Gemini + Groq resilience.
 * - Workflow routing:
 *   - 'summary', 'explanation', 'reply', 'custom': Generative LLM pipeline.
 *   - 'fill_profile': Agent DOM form filling pipeline.
 */

import { SkillDefinition, SkillExecutionResult } from '../../types/skills';
import { AISettings, OutputLanguage } from '../../types/ai';
import { executeResilientContent, streamResilientContent } from './rateLimiter';
import { truncateForContext } from './promptBuilder';

export const MAX_SKILL_CONTEXT_CHARS = 16000;

/**
 * Checks if a skill is intended for the autonomous form filling agent
 */
export function isProfileSkill(skill: SkillDefinition): boolean {
  return (
    skill.actionWorkflow === 'fill_profile' ||
    skill.id === 'skill-fill-profile' ||
    /\b(profile|fill|autofill)\b/i.test(skill.name)
  );
}

/**
 * Sanitizes and wraps untrusted page content or input text to prevent prompt injection.
 */
export function sanitizeContextForSkill(text: string): string {
  if (!text) return '';
  return text
    .replace(/<page_context>/gi, '&lt;page_context&gt;')
    .replace(/<\/page_context>/gi, '&lt;/page_context&gt;')
    .replace(/<user_instructions>/gi, '&lt;user_instructions&gt;')
    .replace(/<\/user_instructions>/gi, '&lt;/user_instructions&gt;');
}

/**
 * Builds the user prompt payload with wrapped context and optional user instructions.
 */
export function buildSkillPromptPayload(
  skill: SkillDefinition,
  contextText: string,
  userInstructions?: string,
  language?: OutputLanguage
): {
  systemInstruction: string;
  userPrompt: string;
} {
  const truncated = truncateForContext(contextText, MAX_SKILL_CONTEXT_CHARS);
  const sanitizedContext = sanitizeContextForSkill(truncated.text);

  let systemInstruction = skill.systemPrompt;

  // If user selected Hinglish mode and the skill is not already the Hinglish explainer
  if (language === 'hinglish' && skill.id !== 'skill-explain-hinglish') {
    systemInstruction += `\n\nLANGUAGE MODE: Output your response in clear, colloquial Roman Hinglish (Hindi written in Roman English script, widely used in India, e.g., 'Yeh concept batata hai ki...'), keeping technical terms and code in English.`;
  }

  let userPrompt = `Please execute the skill "${skill.name}" on the following context:\n\n<page_context>\n${sanitizedContext}\n</page_context>`;

  if (truncated.truncated) {
    userPrompt += '\n\n*(Note: Page context was truncated to fit optimal model context)*';
  }

  if (userInstructions && userInstructions.trim()) {
    const sanitizedInstructions = sanitizeContextForSkill(userInstructions.trim());
    userPrompt += `\n\n<user_instructions>\n${sanitizedInstructions}\n</user_instructions>`;
  }

  return { systemInstruction, userPrompt };
}

export interface ExecuteSkillOptions {
  contextText: string;
  userInstructions?: string;
  settings: AISettings;
  signal?: AbortSignal;
  onStatusUpdate?: (status: string) => void;
  onFallback?: (provider: string, reason: string) => void;
}

/**
 * Execute a skill and return the complete generated result.
 */
export async function executeSkill(
  skill: SkillDefinition,
  options: ExecuteSkillOptions
): Promise<SkillExecutionResult> {
  const { systemInstruction, userPrompt } = buildSkillPromptPayload(
    skill,
    options.contextText,
    options.userInstructions,
    options.settings.language
  );

  const result = await executeResilientContent(userPrompt, {
    systemInstruction,
    apiKey: options.settings.geminiApiKey,
    groqApiKey: options.settings.groqApiKey,
    model: options.settings.model,
    signal: options.signal,
    onFallback: options.onFallback,
  });

  return {
    skillId: skill.id,
    skillName: skill.name,
    workflow: skill.actionWorkflow || 'summary',
    content: result.text,
    completedAt: new Date().toISOString(),
    provider: result.provider,
    model: (result as any).model || options.settings.model,
  };
}

/**
 * Execute a skill with real-time SSE streaming.
 */
export async function streamSkill(
  skill: SkillDefinition,
  options: ExecuteSkillOptions,
  onChunk: (chunk: string) => void
): Promise<SkillExecutionResult> {
  const { systemInstruction, userPrompt } = buildSkillPromptPayload(
    skill,
    options.contextText,
    options.userInstructions,
    options.settings.language
  );

  const result = await streamResilientContent(userPrompt, {
    systemInstruction,
    apiKey: options.settings.geminiApiKey,
    groqApiKey: options.settings.groqApiKey,
    model: options.settings.model,
    signal: options.signal,
    onFallback: options.onFallback,
    onChunk,
  });

  return {
    skillId: skill.id,
    skillName: skill.name,
    workflow: skill.actionWorkflow || 'summary',
    content: result.text,
    completedAt: new Date().toISOString(),
    provider: result.provider,
    model: (result as any).model || options.settings.model,
  };
}
