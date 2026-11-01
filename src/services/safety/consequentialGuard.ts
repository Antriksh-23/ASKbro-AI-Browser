/**
 * ASKbro Consequential Action Guard (Slice 4.3)
 *
 * Deterministic consequential action detection and confirmation guardrails.
 * If target button text includes `submit`, `place order`, `pay`, or `delete`:
 * requires display of an amber confirmation modal with an explicit confirmation toggle.
 */

import type { ActionStep, ActionableElement, CompactActionElement } from '../../types/action';

/**
 * Core keywords that trigger the secondary consequential confirmation warning
 */
export const CONSEQUENTIAL_TARGET_KEYWORDS: readonly string[] = [
  'submit',
  'place order',
  'pay',
  'delete',
] as const;

/**
 * Extended high-stakes semantic keywords for comprehensive coverage
 */
export const EXTENDED_CONSEQUENTIAL_KEYWORDS: readonly string[] = [
  ...CONSEQUENTIAL_TARGET_KEYWORDS,
  'payment',
  'checkout',
  'buy',
  'purchase',
  'transfer',
  'send money',
  'remove',
  'destroy',
  'confirm order',
  'apply now',
  'charge',
  'withdraw',
  'terminate',
  'erase',
] as const;

export interface ConsequentialCheckResult {
  /** Whether the action or target element is consequential */
  isConsequential: boolean;
  /** The matching keyword that triggered the consequential flag */
  matchedKeyword?: string;
  /** Diagnostic human-readable explanation */
  reason?: string;
}

/**
 * Extracts all readable text cues from an element or string
 */
function extractTextCues(
  elementOrText: ActionableElement | CompactActionElement | HTMLElement | Element | string | null | undefined
): string {
  if (!elementOrText) return '';

  if (typeof elementOrText === 'string') {
    return elementOrText.trim().toLowerCase();
  }

  // Native DOM Element
  if (typeof (elementOrText as Element).getAttribute === 'function' || 'tagName' in elementOrText) {
    const el = elementOrText as HTMLElement;
    const parts: string[] = [];

    // Value on buttons or submit inputs
    if ('value' in el && typeof (el as any).value === 'string') {
      parts.push((el as any).value);
    }

    // Text content
    const text = el.innerText || el.textContent || '';
    if (text) parts.push(text);

    // Attributes
    const aria = el.getAttribute('aria-label') || '';
    if (aria) parts.push(aria);
    const title = el.getAttribute('title') || '';
    if (title) parts.push(title);
    const name = el.getAttribute('name') || '';
    if (name) parts.push(name);
    const id = el.id || '';
    if (id) parts.push(id);

    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Parsed metadata object
  const meta = elementOrText as ActionableElement | CompactActionElement;
  const parts: string[] = [];
  if (meta.text) parts.push(meta.text);
  if ('placeholder' in meta && meta.placeholder) parts.push(meta.placeholder);
  if ('ariaLabel' in meta && meta.ariaLabel) parts.push(meta.ariaLabel);
  if ('name' in meta && meta.name) parts.push(meta.name);
  if (meta.type) parts.push(meta.type);

  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Checks if a text snippet contains any of the target consequential keywords.
 */
export function isConsequentialTargetText(text?: string | null): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const keyword of EXTENDED_CONSEQUENTIAL_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Inspects an element or label to detect whether it targets a consequential action.
 */
export function checkConsequentialTarget(
  elementOrText: ActionableElement | CompactActionElement | HTMLElement | Element | string | null | undefined
): ConsequentialCheckResult {
  const cues = extractTextCues(elementOrText);
  if (!cues) {
    return { isConsequential: false };
  }

  // Check against strict required keywords: submit, place order, pay, delete
  for (const keyword of CONSEQUENTIAL_TARGET_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(cues)) {
      return {
        isConsequential: true,
        matchedKeyword: keyword,
        reason: `Target element contains high-impact keyword "${keyword}". Secondary confirmation required.`,
      };
    }
  }

  // Check extended keywords
  for (const keyword of EXTENDED_CONSEQUENTIAL_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(cues)) {
      return {
        isConsequential: true,
        matchedKeyword: keyword,
        reason: `Target element contains consequential keyword "${keyword}". Secondary confirmation required.`,
      };
    }
  }

  // Check HTML input/button type="submit"
  if (typeof elementOrText === 'object' && elementOrText !== null) {
    const type = 'type' in elementOrText ? (elementOrText.type || '').toLowerCase() : '';
    if (type === 'submit') {
      return {
        isConsequential: true,
        matchedKeyword: 'submit',
        reason: 'Target is a form submission element. Secondary confirmation required.',
      };
    }
  }

  return { isConsequential: false };
}

/**
 * Determines whether a planned ActionStep is consequential.
 * Returns true if:
 * 1. The step already has isConsequential: true
 * 2. The target element or button text matches consequential keywords (submit, place order, pay, delete)
 * 3. The step reason explicitly describes submitting, paying, or deleting
 */
export function isActionConsequential(
  step: ActionStep,
  element?: ActionableElement | CompactActionElement | HTMLElement | Element | null
): boolean {
  if (!step) return false;

  // Done or scroll actions are inherently non-destructive
  if (step.action === 'done' || step.action === 'scroll') {
    return false;
  }

  // 1. If step is already marked consequential
  if (step.isConsequential) {
    return true;
  }

  // 2. Check target element cues (submit, place order, pay, delete)
  if (element) {
    const targetCheck = checkConsequentialTarget(element);
    if (targetCheck.isConsequential) {
      return true;
    }
  }

  // 3. Check step reasoning text
  if (step.reason) {
    const reasonLower = step.reason.toLowerCase();
    for (const keyword of CONSEQUENTIAL_TARGET_KEYWORDS) {
      const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (pattern.test(reasonLower)) {
        return true;
      }
    }
  }

  return false;
}

