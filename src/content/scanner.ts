/**
 * ASKbro Interactive Element Scanner (Slice 3.1)
 *
 * Traverses interactive DOM nodes:
 * button, a, input, textarea, select, [role="button"], [tabindex].
 * Filters out hidden elements (display: none, visibility: hidden, opacity: 0, width/height < 5px).
 * Assigns unique sequential integer IDs: 1, 2, 3...
 * Orchestrates rendering of Shadow DOM badges and responds to extension runtime messages.
 */

import { ActionableElement } from '../types/action';
import {
  ScanElementsMessage,
  ScanElementsResponse,
  RemoveBadgesMessage,
  RemoveBadgesResponse,
  DryRunHighlightMessage,
  DryRunHighlightResponse,
} from '../types/messages';
import { isElementVisible } from '../utils/domUtils';
import { isSensitiveField } from '../services/safety/fieldGuard';
import {
  renderBadges,
  removeBadges,
  highlightElement,
  repositionBadges,
} from './badges';

/**
 * Interactive candidate selector string
 */
export const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'a[role="button"]',
  'a[tabindex]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[tabindex]',
  '[contenteditable="true"]',
  'summary',
].join(', ');

export interface ScanOptions {
  /** Root node to search within (defaults to document) */
  root?: ParentNode;
  /** Minimum pixel width and height (defaults to 5) */
  minSize?: number;
  /** Whether to filter out hidden elements (defaults to true) */
  filterHidden?: boolean;
  /** Whether to inject and display Shadow DOM badges (defaults to true) */
  showBadges?: boolean;
  /** Whether to filter out sensitive fields (password, OTP, CVV, Card) via Field Guard (defaults to true) */
  filterSensitive?: boolean;
}

/**
 * Registry mapping ID to HTMLElement and vice versa
 */
const elementRegistry = new Map<number, HTMLElement>();
const reverseRegistry = new WeakMap<HTMLElement, number>();

/**
 * Returns the DOM element associated with an assigned ID
 */
export function getElementById(id: number): HTMLElement | undefined {
  return elementRegistry.get(id);
}

/**
 * Returns the assigned ID for a DOM element if tracked
 */
export function getIdByElement(element: HTMLElement): number | undefined {
  return reverseRegistry.get(element);
}

/**
 * Clears the element registry
 */
export function clearScannerRegistry(): void {
  elementRegistry.clear();
}

/**
 * Checks if an element is an interactive candidate
 */
export function isElementInteractive(element: Element, filterSensitive = true): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;

  // Field Guard (Slice 4.3): Filter out sensitive fields (password, OTP, CVV, card, SSN)
  if (filterSensitive && isSensitiveField(element)) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  if (['button', 'textarea', 'select', 'summary'].includes(tag)) {
    return true;
  }

  if (tag === 'a') {
    return (
      element.hasAttribute('href') ||
      element.getAttribute('role') === 'button' ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('onclick')
    );
  }

  if (tag === 'input') {
    const inputType = (element as HTMLInputElement).type?.toLowerCase();
    return inputType !== 'hidden';
  }

  const role = element.getAttribute('role')?.toLowerCase();
  const interactiveRoles = [
    'button',
    'link',
    'checkbox',
    'radio',
    'tab',
    'menuitem',
    'switch',
    'combobox',
    'searchbox',
  ];
  if (role && interactiveRoles.includes(role)) {
    return true;
  }

  if (element.getAttribute('contenteditable') === 'true') {
    return true;
  }

  // Check tabindex: only consider non-semantic elements interactive if tabindex is not -1
  if (element.hasAttribute('tabindex')) {
    const tabindex = element.getAttribute('tabindex');
    return tabindex !== '-1';
  }

  return false;
}

/**
 * Extracts clean text, placeholder, aria-label and metadata from element
 */
export function extractElementMetadata(
  element: HTMLElement,
  id: number
): ActionableElement {
  const tag = element.tagName.toLowerCase();
  const type =
    (element as HTMLInputElement).type?.toLowerCase() ||
    element.getAttribute('type')?.toLowerCase() ||
    (tag === 'button' ? 'button' : undefined);

  let text = '';
  if (tag === 'input') {
    const inputType = (element as HTMLInputElement).type?.toLowerCase();
    if (['button', 'submit', 'reset'].includes(inputType || '')) {
      text = (element as HTMLInputElement).value || '';
    }
  } else if (tag === 'select') {
    const select = element as HTMLSelectElement;
    if (select.selectedOptions && select.selectedOptions.length > 0) {
      text = Array.from(select.selectedOptions)
        .map((opt) => opt.text.trim())
        .join(', ');
    }
  } else {
    // Collect text content while collapsing multiple whitespaces
    const rawText = element.innerText || element.textContent || '';
    text = rawText.replace(/\s+/g, ' ').trim();
  }

  // Truncate text to 100 characters to prevent huge token usage
  if (text.length > 100) {
    text = text.substring(0, 97) + '...';
  }

  const placeholder = element.getAttribute('placeholder') || undefined;
  const ariaLabel =
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    undefined;
  const name = element.getAttribute('name') || element.id || undefined;
  const role = element.getAttribute('role') || undefined;

  let href: string | undefined = undefined;
  if (tag === 'a' && (element as HTMLAnchorElement).href) {
    href = (element as HTMLAnchorElement).href;
  }

  let value: string | undefined = undefined;
  if (tag === 'input' && type !== 'password' && type !== 'hidden' && !isSensitiveField(element)) {
    value = (element as HTMLInputElement).value || undefined;
  }

  const disabled =
    (element as HTMLButtonElement).disabled ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.hasAttribute('disabled');

  let rect = { top: 0, left: 0, width: 0, height: 0 };
  if (typeof element.getBoundingClientRect === 'function') {
    try {
      const bRect = element.getBoundingClientRect();
      rect = {
        top: Math.round(bRect.top),
        left: Math.round(bRect.left),
        width: Math.round(bRect.width),
        height: Math.round(bRect.height),
      };
    } catch {
      // Bounding client rect not measurable
    }
  }

  return {
    id,
    tag,
    type,
    text: text || undefined,
    placeholder,
    ariaLabel,
    name,
    role,
    disabled: disabled ? true : undefined,
    href,
    value,
    rect,
  };
}

/**
 * Checks whether child should be omitted because its interactive parent is already captured
 * or if they overlap identically
 */
function isNestedRedundant(
  element: HTMLElement,
  candidateList: Set<HTMLElement>
): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (candidateList.has(parent)) {
      // If parent is a button or anchor, and child is just text or icon wrapper inside it
      const parentTag = parent.tagName.toLowerCase();
      const childTag = element.tagName.toLowerCase();

      // If child is also a native button/input inside a link or div
      if (
        (childTag === 'button' || childTag === 'input') &&
        parentTag !== 'button'
      ) {
        // Child is the real button, remove parent from candidate list
        candidateList.delete(parent);
        return false;
      }

      // Check if bounding rects overlap almost identically
      if (
        typeof element.getBoundingClientRect === 'function' &&
        typeof parent.getBoundingClientRect === 'function'
      ) {
        try {
          const rChild = element.getBoundingClientRect();
          const rParent = parent.getBoundingClientRect();
          if (
            Math.abs(rChild.top - rParent.top) < 4 &&
            Math.abs(rChild.left - rParent.left) < 4 &&
            Math.abs(rChild.width - rParent.width) < 6
          ) {
            return true;
          }
        } catch {
          // ignore
        }
      }

      if (parentTag === 'button' || parentTag === 'a') {
        return true;
      }
    }
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Scans the DOM for actionable interactive elements, assigns sequential integer IDs (1, 2, 3...),
 * and optionally renders closed Shadow DOM badge overlays.
 */
export function scanInteractiveElements(
  options: ScanOptions = {}
): ActionableElement[] {
  const root =
    options.root || (typeof document !== 'undefined' ? document : null);
  if (!root) {
    return [];
  }

  const minSize = options.minSize ?? 5;
  const filterHidden = options.filterHidden ?? true;
  const showBadges = options.showBadges ?? true;
  const filterSensitive = options.filterSensitive ?? true;

  // Query all candidates matching interactive selectors
  const queriedNodes = root.querySelectorAll(INTERACTIVE_SELECTOR);
  const validCandidates: HTMLElement[] = [];
  const candidateSet = new Set<HTMLElement>();

  for (let i = 0; i < queriedNodes.length; i++) {
    const node = queriedNodes[i];
    if (!(node instanceof HTMLElement)) continue;

    // Skip elements inside our own badge overlay
    if (
      node.id === 'askbro-badge-root' ||
      node.closest('#askbro-badge-root') ||
      node.hasAttribute('data-askbro-root')
    ) {
      continue;
    }

    // Field Guard (Slice 4.3): Filter out sensitive fields
    if (filterSensitive && isSensitiveField(node)) {
      continue;
    }

    // Interactive check
    if (!isElementInteractive(node, filterSensitive)) {
      continue;
    }

    // Visibility and geometry check (filters display:none, visibility:hidden, opacity:0, width/height < 5px)
    if (filterHidden && !isElementVisible(node, minSize)) {
      continue;
    }

    candidateSet.add(node);
  }

  // Deduplicate nested elements where parent or child is redundant
  for (const el of candidateSet) {
    if (!isNestedRedundant(el, candidateSet)) {
      validCandidates.push(el);
    }
  }

  // Clear previous registry and assign sequential IDs starting at 1
  clearScannerRegistry();

  const actionableElements: ActionableElement[] = [];
  const badgePairs: Array<{ id: number; element: HTMLElement }> = [];

  let nextId = 1;
  for (const el of validCandidates) {
    const id = nextId++;
    elementRegistry.set(id, el);
    reverseRegistry.set(el, id);

    const meta = extractElementMetadata(el, id);
    actionableElements.push(meta);
    badgePairs.push({ id, element: el });
  }

  // Render or remove badges according to showBadges option
  if (showBadges) {
    renderBadges(badgePairs);
  } else {
    removeBadges();
  }

  return actionableElements;
}

/**
 * Refreshes interactive element scan and updates active badge overlay when dynamic SPA DOM mutation occurs.
 * Re-indexes DOM elements to maintain synchronization with virtual DOM mutations.
 */
export function refreshBadgesOnMutation(options?: ScanOptions): ActionableElement[] {
  return scanInteractiveElements({
    showBadges: options?.showBadges ?? true,
    filterHidden: options?.filterHidden ?? true,
    filterSensitive: options?.filterSensitive ?? true,
    root: options?.root,
  });
}

/**
 * Registers message listener for SCAN_ELEMENTS, REMOVE_BADGES, and DRY_RUN_HIGHLIGHT
 */
export function registerScannerListener(): void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime ||
    !chrome.runtime.onMessage
  ) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCAN_ELEMENTS') {
      try {
        const scanMsg = message as ScanElementsMessage;
        const elements = scanInteractiveElements({
          showBadges: scanMsg.showBadges !== false,
        });

        const response: ScanElementsResponse = {
          success: true,
          elements,
          count: elements.length,
        };
        sendResponse(response);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[ASKbro Scanner] Error during SCAN_ELEMENTS:', err);
        const response: ScanElementsResponse = {
          success: false,
          elements: [],
          count: 0,
          error: errorMessage,
        };
        sendResponse(response);
      }
      return true;
    }

    if (message?.type === 'REMOVE_BADGES') {
      try {
        removeBadges();
        clearScannerRegistry();
        const response: RemoveBadgesResponse = { success: true };
        sendResponse(response);
      } catch (err: unknown) {
        const response: RemoveBadgesResponse = {
          success: false,
          error: String(err),
        };
        sendResponse(response);
      }
      return true;
    }

    if (message?.type === 'DRY_RUN_HIGHLIGHT') {
      try {
        const highlightMsg = message as DryRunHighlightMessage;
        const targetId = highlightMsg.targetElementId;
        const duration = highlightMsg.durationMs || 2500;

        const found = highlightElement(targetId, duration);
        const response: DryRunHighlightResponse = {
          success: true,
          found,
        };
        sendResponse(response);
      } catch (err: unknown) {
        const response: DryRunHighlightResponse = {
          success: false,
          found: false,
          error: String(err),
        };
        sendResponse(response);
      }
      return true;
    }

    return false;
  });

  console.log('[ASKbro Scanner] Scanner listener registered successfully.');
}

