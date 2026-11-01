/**
 * ASKbro One-Click Reusable Skills Engine (Slice 4.2)
 *
 * Implements:
 * - Pre-packaged starter skills:
 *   1. Exam Notes: Structured summary focusing on key terms, definitions, and equations.
 *   2. Explain in Hinglish: Conversational breakdown for quick comprehension.
 *   3. Reply to this Politely: Professional draft response to selected emails or posts.
 *   4. Fill from Profile: Autofills known input fields from local memory.
 * - CRUD operations for custom user-created prompt recipes.
 * - Portable JSON import / export with strict Zod validation.
 * - Reset to defaults with preservation of custom skills.
 */

import {
  SkillDefinition,
  SkillDefinitionSchema,
  SkillExportBundle,
  SkillExportBundleSchema,
} from '../../types/skills';
import { getLocalStorage, setLocalStorage } from './index';

export const SKILLS_STORAGE_KEY = 'askbro_saved_skills';

/**
 * Pre-packaged starter skills ready out-of-the-box
 */
export const STARTER_SKILLS: SkillDefinition[] = [
  {
    id: 'skill-exam-notes',
    name: 'Exam Notes',
    description: 'Structured revision notes focusing on key terms, definitions, and equations.',
    systemPrompt: `You are an expert academic tutor and exam preparation specialist.
Analyze the provided webpage content and generate high-yield, structured revision notes for an upcoming exam.

REQUIRED STRUCTURE:
### 1. High-Yield Summary (TL;DR)
A concise 2-sentence executive summary of the entire topic.

### 2. Core Concepts & Definitions
Bullet points highlighting fundamental concepts, principles, and critical terminology.

### 3. Key Formulas, Rules & Technical Terms
List equations, scientific/mathematical rules, code patterns, or legal terms.

### 4. High-Yield Exam Questions & Critical Pitfalls
3 to 4 likely examination questions with brief model answers and common student mistakes to avoid.

Be rigorous, concise, and academically precise.`,
    actionWorkflow: 'summary',
    isBuiltIn: true,
    icon: 'GraduationCap',
    tags: ['study', 'exam', 'notes', 'summary'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'skill-explain-hinglish',
    name: 'Explain in Hinglish',
    description: 'Conversational breakdown for quick comprehension in Roman Hinglish.',
    systemPrompt: `You are ASKbro, a friendly, witty, and razor-sharp AI study buddy for Indian students.
Break down the provided content into conversational, easy-to-understand Hinglish (colloquial Hindi written in the Roman Latin script, as widely spoken across India).

REQUIRED STRUCTURE:
### 1. Asli Baat (Core Idea in 2 Sentences)
Provide a crisp explanation in natural Roman Hinglish clarifying the core concept.

### 2. Simple Breakdown (Bullet Points)
Explain difficult concepts, logic, or mechanisms using relatable everyday Indian analogies (e.g., cricket, chai stall, college life, local trains) while keeping technical terms and code in English.

### 3. Quick Takeaway
One memorable sentence to remember this forever.

TONE: Friendly, upbeat, conversational Roman Hinglish. Avoid Devanagari script. Keep code and technical terms in English.`,
    actionWorkflow: 'explanation',
    isBuiltIn: true,
    icon: 'Languages',
    tags: ['hinglish', 'explain', 'desi', 'study'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'skill-reply-politely',
    name: 'Reply to this Politely',
    description: 'Professional draft response to selected emails or posts.',
    systemPrompt: `You are an expert executive communication coach and professional copywriter.
Based on the provided email, message, or discussion text, craft a polite, thoughtful, and thoroughly professional draft response.

REQUIRED STRUCTURE:
### Subject Line (if applicable)
### Salutation
### Body
- Acknowledge their message warmly and constructively.
- Address key questions, deliverables, or concerns directly with clear reasoning.
- Propose concrete next steps or timeline.
### Professional Sign-off

TONE: Warm, respectful, constructive, and articulate. Tailored for workplace email or collaborative messaging.`,
    actionWorkflow: 'reply',
    isBuiltIn: true,
    icon: 'MailCheck',
    tags: ['email', 'reply', 'communication', 'work'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'skill-fill-profile',
    name: 'Fill from Profile',
    description: 'Autofills known input fields from local memory under human supervision.',
    systemPrompt: `You are ASKbro autonomous browser agent. Your goal is to inspect all interactive input fields, textareas, and select elements on the active webpage, match them against the user's stored local profile (Full Name, Email, Phone, College/University, Major, Graduation Year, Portfolio, LinkedIn, GitHub, Skills), and systematically fill them under human supervision.`,
    actionWorkflow: 'fill_profile',
    isBuiltIn: true,
    icon: 'UserCheck',
    tags: ['autofill', 'form', 'profile', 'agent'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

/**
 * Returns a fresh, deep-cloned copy of the factory starter skills.
 */
export function getStarterSkills(): SkillDefinition[] {
  return JSON.parse(JSON.stringify(STARTER_SKILLS));
}

/**
 * Retrieve all saved skills from storage.
 * If storage is empty, seeds default STARTER_SKILLS.
 */
export async function getSkills(): Promise<SkillDefinition[]> {
  const stored = await getLocalStorage<SkillDefinition[] | null>(SKILLS_STORAGE_KEY, null);

  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    // Seed starter skills
    const initial = getStarterSkills();
    await setLocalStorage(SKILLS_STORAGE_KEY, initial);
    return initial;
  }

  return stored;
}

/**
 * Find a specific skill by its unique identifier.
 */
export async function getSkillById(id: string): Promise<SkillDefinition | null> {
  const skills = await getSkills();
  return skills.find((s) => s.id === id) || null;
}

/**
 * Save or update a skill.
 * If id matches existing, updates in place; otherwise creates new skill.
 */
export async function saveSkill(
  input: Partial<SkillDefinition> & { name: string; systemPrompt: string }
): Promise<SkillDefinition> {
  const skills = await getSkills();
  const now = new Date().toISOString();

  let targetId = input.id?.trim();
  if (!targetId) {
    // Generate a unique ID based on name slug and timestamp
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 30);
    targetId = `skill-${slug || 'custom'}-${Date.now().toString(36)}`;
  }

  const existingIndex = skills.findIndex((s) => s.id === targetId);

  const mergedSkill: SkillDefinition = {
    id: targetId,
    name: input.name.trim(),
    description: (input.description || 'Custom user-created skill recipe.').trim(),
    systemPrompt: input.systemPrompt.trim(),
    actionWorkflow: input.actionWorkflow || 'summary',
    isBuiltIn: input.isBuiltIn ?? (existingIndex >= 0 ? skills[existingIndex].isBuiltIn : false),
    icon: input.icon || (existingIndex >= 0 ? skills[existingIndex].icon : 'Sparkles'),
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      : existingIndex >= 0
      ? skills[existingIndex].tags
      : ['custom'],
    createdAt: existingIndex >= 0 ? skills[existingIndex].createdAt || now : now,
    updatedAt: now,
  };

  // Validate with Zod
  const validated = SkillDefinitionSchema.parse(mergedSkill);

  if (existingIndex >= 0) {
    skills[existingIndex] = validated;
  } else {
    skills.push(validated);
  }

  await setLocalStorage(SKILLS_STORAGE_KEY, skills);
  return validated;
}

/**
 * Delete a skill by its ID.
 */
export async function deleteSkill(id: string): Promise<boolean> {
  const skills = await getSkills();
  const filtered = skills.filter((s) => s.id !== id);

  if (filtered.length === skills.length) {
    return false; // Not found
  }

  await setLocalStorage(SKILLS_STORAGE_KEY, filtered);
  return true;
}

/**
 * Reset starter skills to factory defaults while preserving custom user-created skills.
 */
export async function resetStarterSkills(): Promise<SkillDefinition[]> {
  const current = await getSkills();
  const initial = getStarterSkills();
  const customSkills = current.filter((s) => !s.isBuiltIn && !initial.some((init) => init.id === s.id));

  const merged = [...initial, ...customSkills];
  await setLocalStorage(SKILLS_STORAGE_KEY, merged);
  return merged;
}

/**
 * Export selected or all skills as a portable JSON string.
 */
export async function exportSkillsToJson(skillIds?: string[]): Promise<string> {
  const allSkills = await getSkills();
  const exportList =
    skillIds && skillIds.length > 0
      ? allSkills.filter((s) => skillIds.includes(s.id))
      : allSkills;

  if (exportList.length === 0) {
    throw new Error('No skills selected for export.');
  }

  const bundle: SkillExportBundle = {
    version: '1.0.0',
    generator: 'ASKbro AI Browser',
    exportedAt: new Date().toISOString(),
    skills: exportList,
  };

  // Runtime validation
  SkillExportBundleSchema.parse(bundle);

  return JSON.stringify(bundle, null, 2);
}

/**
 * Import skills from a JSON string with validation.
 * Supports:
 * 1. SkillExportBundle: { version, exportedAt, skills: [...] }
 * 2. Array of skills: SkillDefinition[]
 * 3. Single skill: SkillDefinition
 *
 * Strategies:
 * - 'merge': Updates existing IDs and appends new ones.
 * - 'replace': Clears all custom skills and applies imported skills.
 */
export async function importSkillsFromJson(
  jsonText: string,
  strategy: 'merge' | 'replace' = 'merge'
): Promise<{
  success: boolean;
  importedCount: number;
  errors: string[];
  skills: SkillDefinition[];
}> {
  if (!jsonText || !jsonText.trim()) {
    throw new Error('Import data is empty.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText.trim());
  } catch (err: any) {
    throw new Error(`Invalid JSON syntax: ${err?.message || err}`);
  }

  // Extract skills candidate array
  let rawSkills: any[] = [];
  if (Array.isArray(parsed)) {
    rawSkills = parsed;
  } else if (parsed && Array.isArray(parsed.skills)) {
    rawSkills = parsed.skills;
  } else if (parsed && typeof parsed === 'object' && parsed.name && parsed.systemPrompt) {
    rawSkills = [parsed];
  } else {
    throw new Error('Unrecognized skill format. Expected a skill list or export bundle.');
  }

  const validSkills: SkillDefinition[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawSkills.length; i++) {
    const item = rawSkills[i];
    // If id is missing, auto-generate
    if (!item.id || typeof item.id !== 'string') {
      const slug = (item.name || 'imported')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .substring(0, 24);
      item.id = `skill-imported-${slug}-${Date.now().toString(36)}-${i}`;
    }

    const result = SkillDefinitionSchema.safeParse(item);
    if (result.success) {
      validSkills.push(result.data);
    } else {
      const issueMsg = result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join(', ');
      errors.push(`Skill #${i + 1} ("${item.name || 'Unnamed'}"): ${issueMsg}`);
    }
  }

  if (validSkills.length === 0) {
    throw new Error(
      `No valid skills found in import payload. ${errors.length > 0 ? `Errors: ${errors.join('; ')}` : ''}`
    );
  }

  const current = await getSkills();
  let finalSkills: SkillDefinition[];

  if (strategy === 'replace') {
    // Keep built-ins, replace all custom with imported
    const initial = getStarterSkills();
    const starterMap = new Map(initial.map((s) => [s.id, s]));
    for (const s of validSkills) {
      starterMap.set(s.id, s);
    }
    finalSkills = Array.from(starterMap.values());
  } else {
    // Merge: update existing, append new
    const map = new Map(current.map((s) => [s.id, s]));
    for (const s of validSkills) {
      map.set(s.id, s);
    }
    finalSkills = Array.from(map.values());
  }

  await setLocalStorage(SKILLS_STORAGE_KEY, finalSkills);

  return {
    success: true,
    importedCount: validSkills.length,
    errors,
    skills: finalSkills,
  };
}
