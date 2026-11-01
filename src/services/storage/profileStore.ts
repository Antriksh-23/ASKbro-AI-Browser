/**
 * ASKbro Local Profile Memory Storage & Form Mapping Service (Slice 4.1)
 *
 * Implements:
 * - Local-first user profile persistence in chrome.storage.local (with localStorage dev fallback).
 * - Stores Full Name, Email, Phone, College / University, Major, Graduation Year,
 *   Portfolio / LinkedIn / GitHub URLs, Skills List, Preferred Writing Tone.
 * - JSON import & export for portability and backups.
 * - Profile-to-DOM element heuristic mapping engine for autonomous form autofilling.
 * - Sanitized prompt formatting for injection-contained action planning.
 */

import {
  UserProfile,
  UserProfileSchema,
  DEFAULT_USER_PROFILE,
} from '../../types/profile';
import type { ActionableElement, CompactActionElement, ActionStep } from '../../types/action';
import { getLocalStorage, setLocalStorage, removeLocalStorage } from './index';

export const PROFILE_STORAGE_KEY = 'askbro_user_profile';

/**
 * Retrieve current user profile from local storage.
 * Returns DEFAULT_USER_PROFILE if not yet configured.
 */
export async function getProfile(): Promise<UserProfile> {
  const stored = await getLocalStorage<Partial<UserProfile>>(PROFILE_STORAGE_KEY, {});

  return {
    fullName: stored.fullName?.trim() ?? DEFAULT_USER_PROFILE.fullName,
    email: stored.email?.trim() ?? DEFAULT_USER_PROFILE.email,
    phone: stored.phone?.trim() ?? DEFAULT_USER_PROFILE.phone,
    collegeOrUniversity: stored.collegeOrUniversity?.trim() ?? DEFAULT_USER_PROFILE.collegeOrUniversity,
    major: stored.major?.trim() ?? DEFAULT_USER_PROFILE.major,
    graduationYear: stored.graduationYear?.trim() ?? DEFAULT_USER_PROFILE.graduationYear,
    portfolioUrl: stored.portfolioUrl?.trim() ?? DEFAULT_USER_PROFILE.portfolioUrl,
    linkedinUrl: stored.linkedinUrl?.trim() ?? DEFAULT_USER_PROFILE.linkedinUrl,
    githubUrl: stored.githubUrl?.trim() ?? DEFAULT_USER_PROFILE.githubUrl,
    skills: Array.isArray(stored.skills)
      ? stored.skills.map((s) => s.trim()).filter(Boolean)
      : DEFAULT_USER_PROFILE.skills,
    preferredTone: stored.preferredTone ?? DEFAULT_USER_PROFILE.preferredTone,
  };
}

/**
 * Update and persist user profile in local storage.
 */
export async function saveProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const current = await getProfile();

  const merged: UserProfile = {
    fullName: updates.fullName !== undefined ? updates.fullName.trim() : current.fullName,
    email: updates.email !== undefined ? updates.email.trim() : current.email,
    phone: updates.phone !== undefined ? updates.phone.trim() : current.phone,
    collegeOrUniversity:
      updates.collegeOrUniversity !== undefined
        ? updates.collegeOrUniversity.trim()
        : current.collegeOrUniversity,
    major: updates.major !== undefined ? updates.major.trim() : current.major,
    graduationYear:
      updates.graduationYear !== undefined
        ? updates.graduationYear.trim()
        : current.graduationYear,
    portfolioUrl:
      updates.portfolioUrl !== undefined ? updates.portfolioUrl.trim() : current.portfolioUrl,
    linkedinUrl:
      updates.linkedinUrl !== undefined ? updates.linkedinUrl.trim() : current.linkedinUrl,
    githubUrl: updates.githubUrl !== undefined ? updates.githubUrl.trim() : current.githubUrl,
    skills:
      updates.skills !== undefined
        ? updates.skills.map((s) => s.trim()).filter(Boolean)
        : current.skills,
    preferredTone: updates.preferredTone ?? current.preferredTone,
  };

  await setLocalStorage(PROFILE_STORAGE_KEY, merged);
  return merged;
}

/**
 * Remove user profile from local storage.
 */
export async function clearProfile(): Promise<void> {
  await removeLocalStorage(PROFILE_STORAGE_KEY);
}

/**
 * Check if the user profile contains essential data.
 */
export async function hasProfile(): Promise<boolean> {
  const profile = await getProfile();
  return Boolean(
    profile.fullName.trim() ||
    profile.email.trim() ||
    profile.collegeOrUniversity.trim() ||
    profile.skills.length > 0
  );
}

/**
 * Export the user profile as a formatted JSON string.
 */
export async function exportProfileAsJson(): Promise<string> {
  const profile = await getProfile();
  return JSON.stringify(profile, null, 2);
}

/**
 * Import and validate user profile from a JSON string.
 * Validates with Zod schema and merges into local storage.
 */
export async function importProfileFromJson(jsonStr: string): Promise<UserProfile> {
  if (!jsonStr || !jsonStr.trim()) {
    throw new Error('Profile JSON string cannot be empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Invalid JSON format. Please provide a valid JSON object.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Profile JSON must be an object.');
  }

  const result = UserProfileSchema.safeParse(parsed);
  if (!result.success) {
    const errorDetails = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Profile validation failed: ${errorDetails}`);
  }

  return await saveProfile(result.data);
}

// ---------------------------------------------------------------------------
// Form Mapping & Prompt Utilities
// ---------------------------------------------------------------------------

/**
 * Synthesizes a concise cover note or summary based on user profile and preferred tone.
 */
export function generateCoverNoteFromProfile(profile: UserProfile): string {
  const name = profile.fullName.trim();
  const college = profile.collegeOrUniversity.trim();
  const major = profile.major.trim();
  const skillsStr = profile.skills.length > 0 ? profile.skills.slice(0, 5).join(', ') : '';

  if (profile.preferredTone === 'hinglish') {
    const intro = name ? `${name} yahan. ` : '';
    const edu = college ? `${college} se ${major || 'engineering'} background. ` : '';
    const skills = skillsStr ? `Key skills: ${skillsStr}. ` : '';
    return `${intro}${edu}${skills}Enthusiastic about building impactful software projects.`.trim();
  }

  if (profile.preferredTone === 'casual') {
    const intro = name ? `Hi, I'm ${name}! ` : 'Hi! ';
    const edu = college ? `Currently studying ${major || 'computer science'} at ${college}. ` : '';
    const skills = skillsStr ? `Passionate about building software with ${skillsStr}. ` : '';
    return `${intro}${edu}${skills}Excited for this opportunity to collaborate and learn!`.trim();
  }

  // Professional tone (default)
  const intro = name ? `${name}` : '';
  const edu = major && college ? ` - ${major} student at ${college}.` : college ? ` - Student at ${college}.` : '.';
  const skills = skillsStr ? ` Proficient in ${skillsStr}.` : '';
  return `${intro}${edu}${skills} Committed to delivering high quality technical solutions and driving team impact.`.trim();
}

export interface MatchedProfileField {
  fieldName: keyof UserProfile | 'firstName' | 'lastName' | 'coverNote' | 'terms';
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Matches an actionable element to a user profile field based on tag, type, name, id,
 * placeholder, and text labels.
 */
export function matchProfileFieldForElement(
  element: ActionableElement | CompactActionElement,
  profile: UserProfile
): MatchedProfileField | null {
  const tag = ('tag' in element ? element.tag : '').toLowerCase();
  const rawType = (element.type || '').toLowerCase();

  // Non-fillable elements (buttons, links, search buttons) are excluded unless checking agreement
  if (
    tag === 'button' ||
    rawType === 'button' ||
    rawType === 'submit' ||
    rawType === 'link' ||
    tag === 'a'
  ) {
    return null;
  }

  // Aggregate searchable cues from element attributes
  // Normalize underscores, dashes, and extra spaces so word boundaries work on names like "degree_major", "full_name", etc.
  const cues = [
    element.name,
    element.placeholder,
    element.ariaLabel,
    element.text,
    rawType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  // 1. Cover Note / Statement / Bio / Textarea
  if (
    tag === 'textarea' ||
    /\b(cover[_\s-]?note|cover[_\s-]?letter|about[_\s-]?you|bio|summary|statement|pitch|why[_\s-]?join)\b/i.test(cues)
  ) {
    if (profile.fullName || profile.collegeOrUniversity || profile.skills.length > 0) {
      return {
        fieldName: 'coverNote',
        value: generateCoverNoteFromProfile(profile),
        confidence: 'high',
      };
    }
  }

  // 2. Email (type=email or cues containing email)
  if (rawType === 'email' || /\b(email|e-mail)\b/i.test(cues)) {
    if (profile.email) {
      return { fieldName: 'email', value: profile.email, confidence: 'high' };
    }
  }

  // 3. Phone / Mobile (type=tel, input[tel], or cues containing phone/mobile/contact)
  if (
    rawType === 'tel' ||
    rawType.includes('tel') ||
    /(phone|mobile|telephone|contact|cell)/i.test(cues)
  ) {
    if (profile.phone) {
      return { fieldName: 'phone', value: profile.phone, confidence: 'high' };
    }
  }

  // 4. College / University / Institute / Campus
  if (/\b(college|university|school|institution|institute|campus|alma[_\s-]?mater)\b/i.test(cues)) {
    if (profile.collegeOrUniversity) {
      return { fieldName: 'collegeOrUniversity', value: profile.collegeOrUniversity, confidence: 'high' };
    }
  }

  // 5. Major / Degree / Field of Study
  if (/\b(major|degree|field[_\s-]?of[_\s-]?study|department|stream|branch|course)\b/i.test(cues)) {
    if (profile.major) {
      return { fieldName: 'major', value: profile.major, confidence: 'high' };
    }
  }

  // 6. Split First Name & Last Name
  if (/\b(first[_\s-]?name|fname|given[_\s-]?name)\b/i.test(cues)) {
    if (profile.fullName) {
      const firstName = profile.fullName.trim().split(/\s+/)[0];
      return { fieldName: 'firstName', value: firstName, confidence: 'high' };
    }
  }

  if (/\b(last[_\s-]?name|lname|surname|family[_\s-]?name)\b/i.test(cues)) {
    if (profile.fullName) {
      const parts = profile.fullName.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      return { fieldName: 'lastName', value: lastName, confidence: 'high' };
    }
  }

  // 7. Full Name (excluding fields for college/university/company/file/username)
  if (
    /\b(full[_\s-]?name|applicant[_\s-]?name|candidate[_\s-]?name|your[_\s-]?name|legal[_\s-]?name)\b/i.test(cues) ||
    (/\bname\b/i.test(cues) && !/\b(user[_\s-]?name|file|company|org|role|track|college|university|school|institute|campus)\b/i.test(cues))
  ) {
    if (profile.fullName) {
      return { fieldName: 'fullName', value: profile.fullName, confidence: 'high' };
    }
  }

  // 8. Graduation Year / Passing Year
  if (/\b(grad(?:uation)?[_\s-]?(?:year|date)|passing[_\s-]?year|year[_\s-]?of[_\s-]?passing|batch|class[_\s-]?of|yop)\b/i.test(cues)) {
    if (profile.graduationYear) {
      return { fieldName: 'graduationYear', value: profile.graduationYear, confidence: 'high' };
    }
  }

  // 9. Online Presence URLs (only for non-textarea inputs)
  if (tag !== 'textarea') {
    if (/\b(linkedin|linked[_\s-]?in)\b/i.test(cues)) {
      if (profile.linkedinUrl) {
        return { fieldName: 'linkedinUrl', value: profile.linkedinUrl, confidence: 'high' };
      }
    }

    if (/\b(github|git[_\s-]?hub)\b/i.test(cues)) {
      if (profile.githubUrl) {
        return { fieldName: 'githubUrl', value: profile.githubUrl, confidence: 'high' };
      }
    }

    if (/\b(portfolio|personal[_\s-]?site|personal[_\s-]?website|website|homepage)\b/i.test(cues)) {
      if (profile.portfolioUrl) {
        return { fieldName: 'portfolioUrl', value: profile.portfolioUrl, confidence: 'high' };
      }
    }
  }

  // 10. Skills List
  if (/\b(skills|technologies|tech[_\s-]?stack|expertise|competencies)\b/i.test(cues)) {
    if (profile.skills && profile.skills.length > 0) {
      return { fieldName: 'skills', value: profile.skills.join(', '), confidence: 'high' };
    }
  }

  return null;
}

/**
 * Maps an entire Action Map array to matching profile values.
 * Returns only interactive elements that correspond to a populated user profile field.
 */
export function mapProfileToFormElements(
  elements: (ActionableElement | CompactActionElement)[],
  profile: UserProfile
): Array<{ element: ActionableElement | CompactActionElement; fieldName: string; value: string }> {
  if (!elements || elements.length === 0) return [];

  const matchedList: Array<{
    element: ActionableElement | CompactActionElement;
    fieldName: string;
    value: string;
  }> = [];

  for (const el of elements) {
    const match = matchProfileFieldForElement(el, profile);
    if (match && match.value.trim()) {
      matchedList.push({
        element: el,
        fieldName: match.fieldName,
        value: match.value,
      });
    }
  }

  return matchedList;
}

/**
 * Formats user profile into clean, injection-safe text for LLM prompts (<user_profile>).
 */
export function formatProfileForPrompt(profile: UserProfile): string {
  const sanitize = (val: string) => val.replace(/[<>]/g, '').trim();

  const lines: string[] = [];
  if (profile.fullName) lines.push(`Full Name: ${sanitize(profile.fullName)}`);
  if (profile.email) lines.push(`Email: ${sanitize(profile.email)}`);
  if (profile.phone) lines.push(`Phone: ${sanitize(profile.phone)}`);
  if (profile.collegeOrUniversity) lines.push(`College / University: ${sanitize(profile.collegeOrUniversity)}`);
  if (profile.major) lines.push(`Major: ${sanitize(profile.major)}`);
  if (profile.graduationYear) lines.push(`Graduation Year: ${sanitize(profile.graduationYear)}`);
  if (profile.portfolioUrl) lines.push(`Portfolio URL: ${sanitize(profile.portfolioUrl)}`);
  if (profile.linkedinUrl) lines.push(`LinkedIn URL: ${sanitize(profile.linkedinUrl)}`);
  if (profile.githubUrl) lines.push(`GitHub URL: ${sanitize(profile.githubUrl)}`);
  if (profile.skills && profile.skills.length > 0) {
    lines.push(`Skills: ${sanitize(profile.skills.join(', '))}`);
  }
  if (profile.preferredTone) lines.push(`Preferred Writing Tone: ${profile.preferredTone}`);

  return lines.join('\n');
}

/**
 * Automatically plans the next logical form-filling action step from user profile memory.
 * Evaluates the action map and history:
 * 1. Finds the next unfilled interactive form field (input, textarea, select) that maps to a profile field.
 * 2. If all mapped fields are filled, checks if an unchecked agreement checkbox exists (terms, verify).
 * 3. If checkboxes are handled, checks if a consequential submit button exists.
 * 4. If all done or already submitted, returns 'done'.
 */
export function planFormFillFromProfile(
  elements: (ActionableElement | CompactActionElement)[],
  profile: UserProfile,
  history: Array<{ action: string; targetId: number | null; status?: string }> = []
): ActionStep | null {
  const completedTargetIds = new Set(
    history
      .filter((h) => h.status !== 'rejected' && h.status !== 'failed' && h.targetId !== null)
      .map((h) => h.targetId)
  );

  // 1. Find next unfilled form field with profile match
  for (const el of elements) {
    if (completedTargetIds.has(el.id)) continue;

    const match = matchProfileFieldForElement(el, profile);
    if (match && match.value) {
      const tag = ('tag' in el ? el.tag : '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      const isSelect = tag === 'select' || type.includes('select');

      return {
        action: isSelect ? 'select' : 'type',
        targetId: el.id,
        targetElementId: el.id,
        value: match.value,
        reason: `Fill ${match.fieldName} with "${match.value}" from local profile`,
        isConsequential: false,
      };
    }
  }

  // 2. Check for agreement / terms checkbox if present and not yet clicked
  for (const el of elements) {
    if (completedTargetIds.has(el.id)) continue;
    const type = (el.type || '').toLowerCase();
    const cues = [el.name, el.placeholder, el.ariaLabel, el.text, type].filter(Boolean).join(' ').toLowerCase();

    if (
      (type === 'checkbox' || type.includes('checkbox')) &&
      /\b(terms|agree|certify|accuracy|confirm|accept)\b/i.test(cues)
    ) {
      return {
        action: 'click',
        targetId: el.id,
        targetElementId: el.id,
        value: null,
        reason: 'Confirm accuracy and agreement checkbox',
        isConsequential: false,
      };
    }
  }

  // 3. Check for submit button if present and not yet clicked
  for (const el of elements) {
    if (completedTargetIds.has(el.id)) continue;
    const tag = ('tag' in el ? el.tag : '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const cues = [el.name, el.placeholder, el.ariaLabel, el.text, type].filter(Boolean).join(' ').toLowerCase();

    if (
      (tag === 'button' || type === 'submit' || type === 'button') &&
      /\b(submit|apply|send application|register|finish)\b/i.test(cues)
    ) {
      return {
        action: 'click',
        targetId: el.id,
        targetElementId: el.id,
        value: null,
        reason: 'Submit the completed form',
        isConsequential: true,
      };
    }
  }

  // 4. Form complete
  return {
    action: 'done',
    targetId: null,
    targetElementId: null,
    value: null,
    reason: 'All form fields have been populated from local profile memory.',
    isConsequential: false,
  };
}
