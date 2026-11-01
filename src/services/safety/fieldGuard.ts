/**
 * ASKbro Field Guard (Slice 4.3)
 *
 * Deterministic sensitive field inspection & rejection guardrail.
 * In scanner.ts and executor.ts, explicitly rejects inputs matching:
 * - input[type="password"]
 * - input[autocomplete*="one-time-code"]
 * - input[autocomplete*="cc-"]
 * - RegEx matching /(otp|cvv|pin|card|ssn)/i on name, id, or placeholder
 *
 * Prevents sensitive authentication, payment, and secret credentials from
 * ever being scanned, badge-overlayed, exposed to LLMs, or executed upon.
 */

import type { ActionableElement, CompactActionElement } from '../../types/action';

/**
 * Deterministic sensitive keyword pattern targeting OTP, CVV, PIN, Card, and SSN
 */
export const SENSITIVE_FIELD_REGEX = /(otp|cvv|cvc|pin|card|ssn|passcode|token|secret)/i;

export interface FieldSafetyResult {
  /** Whether the field is safe for automated reading and typing */
  isSafe: boolean;
  /** Whether the field was identified as sensitive */
  isSensitive: boolean;
  /** Diagnostic human-readable reason if blocked */
  reason?: string;
  /** The specific rule that matched */
  matchedRule?: 'password' | 'one-time-code' | 'credit-card' | 'sensitive-regex';
  /** The attribute name that contained the sensitive cue */
  matchedAttribute?: string;
  /** The sensitive text or value detected */
  matchedValue?: string;
}

/**
 * Checks if a native DOM element or parsed element metadata matches sensitive field criteria.
 */
export function checkFieldSafety(
  element: Element | HTMLElement | ActionableElement | CompactActionElement | null | undefined
): FieldSafetyResult {
  if (!element) {
    return {
      isSafe: true,
      isSensitive: false,
    };
  }

  // Branch A: Native DOM Element (Element / HTMLElement / HTMLInputElement)
  if (typeof (element as Element).getAttribute === 'function' || 'tagName' in element && typeof (element as any).tagName === 'string') {
    const el = element as HTMLElement;
    const tag = (el.tagName || '').toLowerCase();

    // 1. Password input check: input[type="password"]
    const inputType =
      (el as HTMLInputElement).type?.toLowerCase() ||
      el.getAttribute('type')?.toLowerCase() ||
      '';

    if (inputType === 'password') {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'password',
        matchedAttribute: 'type',
        matchedValue: 'password',
        reason: 'Password inputs are strictly protected from automated access.',
      };
    }

    // 2. One-Time Code / OTP autocomplete check: input[autocomplete*="one-time-code"]
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete.includes('one-time-code')) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'one-time-code',
        matchedAttribute: 'autocomplete',
        matchedValue: autocomplete,
        reason: 'One-time-code (OTP) inputs are strictly protected from automated access.',
      };
    }

    // 3. Credit Card autocomplete check: input[autocomplete*="cc-"]
    if (autocomplete.includes('cc-')) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'credit-card',
        matchedAttribute: 'autocomplete',
        matchedValue: autocomplete,
        reason: 'Credit card autofill inputs are strictly protected from automated access.',
      };
    }

    // 4. RegEx matching /(otp|cvv|pin|card|ssn)/i on name, id, or placeholder
    const name = el.getAttribute('name') || '';
    if (name && SENSITIVE_FIELD_REGEX.test(name)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'name',
        matchedValue: name,
        reason: `Sensitive field name "${name}" matches protected security pattern (OTP/CVV/PIN/Card/SSN).`,
      };
    }

    const id = el.id || el.getAttribute('id') || '';
    if (id && SENSITIVE_FIELD_REGEX.test(id)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'id',
        matchedValue: id,
        reason: `Sensitive field id "${id}" matches protected security pattern (OTP/CVV/PIN/Card/SSN).`,
      };
    }

    const placeholder = el.getAttribute('placeholder') || '';
    if (placeholder && SENSITIVE_FIELD_REGEX.test(placeholder)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'placeholder',
        matchedValue: placeholder,
        reason: `Sensitive placeholder "${placeholder}" matches protected security pattern (OTP/CVV/PIN/Card/SSN).`,
      };
    }

    // Supplementary check on aria-label or title
    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (ariaLabel && SENSITIVE_FIELD_REGEX.test(ariaLabel)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'aria-label',
        matchedValue: ariaLabel,
        reason: `Sensitive label "${ariaLabel}" matches protected security pattern (OTP/CVV/PIN/Card/SSN).`,
      };
    }

    // 5. Split OTP / 2FA single-character input box detection (e.g. 4-8 single-digit inputs)
    if (tag === 'input') {
      const maxLen = el.getAttribute('maxlength');
      const size = el.getAttribute('size');
      const inputmode = (el.getAttribute('inputmode') || '').toLowerCase();
      const pattern = el.getAttribute('pattern') || '';
      const isSingleChar = maxLen === '1' || size === '1';

      if (isSingleChar) {
        // Direct numeric verification code indicators
        if (inputmode === 'numeric' || pattern.includes('[0-9]') || pattern.includes('\\d')) {
          return {
            isSafe: false,
            isSensitive: true,
            matchedRule: 'one-time-code',
            matchedAttribute: 'maxlength',
            matchedValue: '1',
            reason: 'Single-character numeric verification code input (Split OTP/2FA) is strictly protected.',
          };
        }

        // Sibling cluster check: If 3 or more single-character input siblings exist in the same parent form/container
        const parent = el.parentElement;
        if (parent) {
          const singleCharSiblings = parent.querySelectorAll('input[maxlength="1"], input[size="1"]');
          if (singleCharSiblings.length >= 3) {
            return {
              isSafe: false,
              isSensitive: true,
              matchedRule: 'one-time-code',
              matchedAttribute: 'maxlength',
              matchedValue: `${singleCharSiblings.length} split inputs`,
              reason: `Split OTP / 2FA sequence detected (${singleCharSiblings.length} single-character inputs).`,
            };
          }
        }
      }
    }

    // 6. data-testid attribute inspection
    const testId = el.getAttribute('data-testid') || '';
    if (testId && SENSITIVE_FIELD_REGEX.test(testId)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'data-testid',
        matchedValue: testId,
        reason: `Sensitive testid "${testId}" matches protected security pattern (OTP/CVV/PIN/Card/SSN).`,
      };
    }

    return {
      isSafe: true,
      isSensitive: false,
    };
  }

  // Branch B: Parsed Metadata Object (ActionableElement | CompactActionElement)
  const meta = element as ActionableElement | CompactActionElement;

  // 1. Password type check
  const metaType = (meta.type || '').toLowerCase();
  if (metaType === 'password') {
    return {
      isSafe: false,
      isSensitive: true,
      matchedRule: 'password',
      matchedAttribute: 'type',
      matchedValue: 'password',
      reason: 'Password inputs are strictly protected from automated access.',
    };
  }

  // 2. Check name
  const metaName = ('name' in meta ? meta.name : '') || '';
  if (metaName && SENSITIVE_FIELD_REGEX.test(metaName)) {
    return {
      isSafe: false,
      isSensitive: true,
      matchedRule: 'sensitive-regex',
      matchedAttribute: 'name',
      matchedValue: metaName,
      reason: `Sensitive field name "${metaName}" matches protected security pattern.`,
    };
  }

  // 3. Check placeholder
  const metaPlaceholder = ('placeholder' in meta ? meta.placeholder : '') || '';
  if (metaPlaceholder && SENSITIVE_FIELD_REGEX.test(metaPlaceholder)) {
    return {
      isSafe: false,
      isSensitive: true,
      matchedRule: 'sensitive-regex',
      matchedAttribute: 'placeholder',
      matchedValue: metaPlaceholder,
      reason: `Sensitive placeholder "${metaPlaceholder}" matches protected security pattern.`,
    };
  }

  // 4. Check text / ariaLabel cues
  const metaAria = ('ariaLabel' in meta ? meta.ariaLabel : '') || '';
  if (metaAria && SENSITIVE_FIELD_REGEX.test(metaAria)) {
    return {
      isSafe: false,
      isSensitive: true,
      matchedRule: 'sensitive-regex',
      matchedAttribute: 'ariaLabel',
      matchedValue: metaAria,
      reason: `Sensitive aria label "${metaAria}" matches protected security pattern.`,
    };
  }

  const metaText = meta.text || '';
  // Only check text for input/card cues if element is an input-like element
  if (metaType.includes('input') || metaType.includes('text') || ('tag' in meta && meta.tag === 'input')) {
    if (metaText && SENSITIVE_FIELD_REGEX.test(metaText)) {
      return {
        isSafe: false,
        isSensitive: true,
        matchedRule: 'sensitive-regex',
        matchedAttribute: 'text',
        matchedValue: metaText,
        reason: `Sensitive input text cue matches protected security pattern.`,
      };
    }
  }

  return {
    isSafe: true,
    isSensitive: false,
  };
}

/**
 * Returns true if an element matches any sensitive field guardrail.
 */
export function isSensitiveField(
  element: Element | HTMLElement | ActionableElement | CompactActionElement | null | undefined
): boolean {
  return checkFieldSafety(element).isSensitive;
}

