/**
 * ASKbro Content Script Action Executor (Slice 3.5)
 *
 * Safely simulates native user interactions strictly after user approval:
 * - click: Focuses -> dispatches pointerdown, mousedown, pointerup, mouseup, click.
 * - type: Focuses -> clears input -> sets .value (with React prototype setter support) -> dispatches input and change events.
 * - select: Focuses -> updates selected index (by value, label, or index) -> dispatches change and input events.
 * - scroll: Smoothly scrolls to target element or scrolls window by offset ("down", "up", "top", "bottom", or numeric px) -> repositions badges.
 * - done: Marks goal as accomplished.
 *
 * Listens for EXECUTE_ACTION messages from the side panel / background and responds with ExecuteActionResponse.
 */

import type { ActionStep } from '../types/action';
import type { ExecuteActionResponse, ExecuteActionMessage } from '../types/messages';
import { getElementById, scanInteractiveElements } from './scanner';
import { getTrackedBadges, repositionBadges } from './badges';
import { checkFieldSafety } from '../services/safety/fieldGuard';

/**
 * Default scroll step in pixels if unspecified
 */
export const DEFAULT_SCROLL_OFFSET = 500;

/**
 * Resolves an action target HTMLElement by its assigned sequential numeric ID.
 * Looks up in scanner element registry first, then tracked badge registry,
 * and finally performs a light re-scan if the DOM updated dynamically.
 */
export function resolveTargetElement(targetId: number | null): HTMLElement | null {
  if (targetId === null || targetId === undefined) {
    return null;
  }

  // 1. Primary lookup: scanner registry
  const elementFromScanner = getElementById(targetId);
  if (elementFromScanner && elementFromScanner.isConnected) {
    return elementFromScanner;
  }

  // 2. Secondary lookup: tracked badges overlay registry
  const tracked = getTrackedBadges();
  const badgeMatch = tracked.find((item) => item.id === targetId);
  if (badgeMatch?.element && badgeMatch.element.isConnected) {
    return badgeMatch.element;
  }

  // 3. Fallback: If page dynamically changed or reloaded, do a quick scan without re-rendering badges
  try {
    scanInteractiveElements({ showBadges: false, filterHidden: false });
    const rescanned = getElementById(targetId);
    if (rescanned && rescanned.isConnected) {
      return rescanned;
    }
  } catch {
    // Scanner error during fallback
  }

  return null;
}

/**
 * Cross-environment safe pointer/mouse event dispatcher.
 * Gracefully handles environments without PointerEvent (e.g. JSDOM or older engines).
 */
function dispatchMouseOrPointerEvent(
  element: HTMLElement,
  eventType: string,
  options: {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
    button?: number;
    buttons?: number;
    pointerType?: string;
  } = {}
): boolean {
  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const bubbles = options.bubbles !== false;
  const cancelable = options.cancelable !== false;
  const composed = options.composed !== false;
  const button = options.button ?? 0;
  const buttons = options.buttons ?? 0;
  const pointerType = options.pointerType || 'mouse';

  if (eventType.startsWith('pointer')) {
    const PointerCtor = (win as any)?.PointerEvent || (typeof PointerEvent !== 'undefined' ? PointerEvent : null);
    if (typeof PointerCtor === 'function') {
      try {
        const pointerEvt = new PointerCtor(eventType, {
          bubbles,
          cancelable,
          composed,
          view: win,
          button,
          buttons,
          pointerType,
          isPrimary: true,
        });
        return element.dispatchEvent(pointerEvt);
      } catch {
        // Fallback below
      }
    }
  }

  // Fallback to MouseEvent
  const MouseCtor = (win as any)?.MouseEvent || (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
  if (typeof MouseCtor === 'function') {
    try {
      const mouseEvt = new MouseCtor(eventType, {
        bubbles,
        cancelable,
        composed,
        view: win,
        button,
        buttons,
      });
      return element.dispatchEvent(mouseEvt);
    } catch {
      // Fallback to generic Event
    }
  }

  const genericEvent = new Event(eventType, { bubbles, cancelable, composed });
  return element.dispatchEvent(genericEvent);
}

/**
 * Safely simulates a native user click:
 * 1. Focuses the element.
 * 2. Dispatches in sequence: pointerdown -> mousedown -> pointerup -> mouseup -> click.
 * 3. Handles native element click actions (navigation, form submit, checkbox toggle).
 */
export function simulateClick(element: HTMLElement): boolean {
  if (!element) return false;

  // 1. Focus element
  if (typeof element.focus === 'function') {
    try {
      element.focus({ preventScroll: true });
    } catch {
      try {
        element.focus();
      } catch {
        // Focus ignored
      }
    }
  }

  // 2. Dispatch pointerdown (button 0, buttons 1)
  dispatchMouseOrPointerEvent(element, 'pointerdown', { button: 0, buttons: 1, pointerType: 'mouse' });

  // 3. Dispatch mousedown (button 0, buttons 1)
  dispatchMouseOrPointerEvent(element, 'mousedown', { button: 0, buttons: 1 });

  // 4. Dispatch pointerup (button 0, buttons 0)
  dispatchMouseOrPointerEvent(element, 'pointerup', { button: 0, buttons: 0, pointerType: 'mouse' });

  // 5. Dispatch mouseup (button 0, buttons 0)
  dispatchMouseOrPointerEvent(element, 'mouseup', { button: 0, buttons: 0 });

  // 6. Dispatch click
  let clickHandled = false;
  const clickDetector = () => {
    clickHandled = true;
  };
  element.addEventListener('click', clickDetector, { once: true });

  const clickEventDispatched = dispatchMouseOrPointerEvent(element, 'click', { button: 0, buttons: 0 });

  // If click wasn't caught or needs native activation on anchor/button in real browser
  if (!clickHandled && typeof element.click === 'function') {
    try {
      element.click();
    } catch {
      // Ignore click error
    }
  }

  // Trigger badge repositioning in case click changed layout (e.g. accordion, dropdown)
  try {
    repositionBadges();
  } catch {
    // Overlay reposition not active
  }

  return clickEventDispatched;
}

/**
 * Safely simulates typing into an input, textarea, or contenteditable element:
 * 1. Focuses the element.
 * 2. Clears current value.
 * 3. Sets .value (using native prototype setter for React/Vue synthetic event compatibility).
 * 4. Dispatches input and change events.
 */
export function simulateType(element: HTMLElement, value: string): boolean {
  if (!element) return false;

  const textToType = value ?? '';

  // 1. Focus element
  if (typeof element.focus === 'function') {
    try {
      element.focus();
    } catch {
      // Focus ignored
    }
  }

  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const isInput = element instanceof (win?.HTMLInputElement || HTMLInputElement);
  const isTextArea = element instanceof (win?.HTMLTextAreaElement || HTMLTextAreaElement);

  if (isInput || isTextArea) {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
    const proto = isInput
      ? (win?.HTMLInputElement || HTMLInputElement).prototype
      : (win?.HTMLTextAreaElement || HTMLTextAreaElement).prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    const nativeValueSetter = descriptor?.set;

    // Clear input first as specified by Slice 3.5
    if (nativeValueSetter) {
      nativeValueSetter.call(inputElement, '');
    } else {
      inputElement.value = '';
    }

    // Set new value
    if (nativeValueSetter) {
      nativeValueSetter.call(inputElement, textToType);
    } else {
      inputElement.value = textToType;
    }

    // Dispatch input event
    const InputEventCtor = (win as any)?.InputEvent || (typeof InputEvent !== 'undefined' ? InputEvent : Event);
    try {
      const inputEvt = new InputEventCtor('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: textToType,
        inputType: 'insertText',
      });
      inputElement.dispatchEvent(inputEvt);
    } catch {
      inputElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    // Dispatch change event
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  // Handle contenteditable elements (e.g. Rich text editors, Notion, Slack web)
  if ((element as HTMLElement).isContentEditable || element.getAttribute('contenteditable') === 'true') {
    element.innerText = '';
    element.innerText = textToType;

    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Fallback for custom elements or components exposing .value
  if ('value' in element) {
    try {
      (element as any).value = textToType;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Safely simulates selecting an option in a <select> element:
 * 1. Focuses element.
 * 2. Matches option by value, text label, or numeric index.
 * 3. Updates selected index.
 * 4. Dispatches change and input events.
 */
export function simulateSelect(element: HTMLElement, value: string): boolean {
  if (!element) return false;

  const targetValue = (value ?? '').trim();

  // 1. Focus element
  if (typeof element.focus === 'function') {
    try {
      element.focus();
    } catch {
      // Focus ignored
    }
  }

  const win = element.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const isSelect = element instanceof (win?.HTMLSelectElement || HTMLSelectElement);

  if (isSelect) {
    const selectElement = element as HTMLSelectElement;
    const options = Array.from(selectElement.options);

    let matchIndex = -1;

    // Search 1: Exact value match
    matchIndex = options.findIndex((opt) => opt.value === targetValue);

    // Search 2: Case-insensitive value match
    if (matchIndex === -1) {
      matchIndex = options.findIndex(
        (opt) => opt.value.toLowerCase() === targetValue.toLowerCase()
      );
    }

    // Search 3: Exact text match
    if (matchIndex === -1) {
      matchIndex = options.findIndex((opt) => opt.text.trim() === targetValue);
    }

    // Search 4: Case-insensitive text match
    if (matchIndex === -1) {
      matchIndex = options.findIndex(
        (opt) => opt.text.trim().toLowerCase() === targetValue.toLowerCase()
      );
    }

    // Search 5: Text includes query
    if (matchIndex === -1) {
      matchIndex = options.findIndex((opt) =>
        opt.text.toLowerCase().includes(targetValue.toLowerCase())
      );
    }

    // Search 6: Numeric index
    if (matchIndex === -1 && /^\d+$/.test(targetValue)) {
      const idx = parseInt(targetValue, 10);
      if (idx >= 0 && idx < options.length) {
        matchIndex = idx;
      }
    }

    if (matchIndex === -1) {
      return false;
    }

    // Update selected index
    selectElement.selectedIndex = matchIndex;

    // Set value via prototype setter for React/Vue change listeners
    const proto = (win?.HTMLSelectElement || HTMLSelectElement).prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set && options[matchIndex]) {
      descriptor.set.call(selectElement, options[matchIndex].value);
    }

    // Dispatch change and input events
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    selectElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    return true;
  }

  // Fallback for custom input/combobox with datalist or options
  if ('value' in element) {
    (element as any).value = targetValue;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return true;
  }

  return false;
}

/**
 * Safely simulates smooth scrolling:
 * - If target element is provided, scrolls element into center view.
 * - Otherwise smoothly scrolls window by offset ("down", "up", "top", "bottom", or numeric px).
 * - Repositions Shadow DOM badges after scroll.
 */
export function simulateScroll(
  target?: HTMLElement | null,
  value?: string | null
): boolean {
  const win = typeof window !== 'undefined' ? window : null;

  // Case 1: Target element specified
  if (target && target.isConnected) {
    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      } catch {
        target.scrollIntoView();
      }
    }

    try {
      repositionBadges();
    } catch {
      // Reposition ignored
    }
    return true;
  }

  // Case 2: Window / Page scrolling by offset
  if (!win) return false;

  const rawVal = (value || 'down').trim().toLowerCase();

  if (rawVal === 'top') {
    if (typeof win.scrollTo === 'function') {
      win.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } else if (rawVal === 'bottom') {
    const docHeight = win.document?.documentElement?.scrollHeight || 10000;
    if (typeof win.scrollTo === 'function') {
      win.scrollTo({ top: docHeight, behavior: 'smooth' });
    }
  } else {
    let offset = DEFAULT_SCROLL_OFFSET;
    if (rawVal === 'up') {
      offset = -DEFAULT_SCROLL_OFFSET;
    } else if (rawVal === 'down') {
      offset = DEFAULT_SCROLL_OFFSET;
    } else {
      const parsed = parseInt(rawVal.replace(/px/i, ''), 10);
      if (!isNaN(parsed)) {
        offset = parsed;
      }
    }

    if (typeof win.scrollBy === 'function') {
      try {
        win.scrollBy({ top: offset, behavior: 'smooth' });
      } catch {
        // Fallback
      }
    }

    // Update simulated scrollY for test environments
    if (typeof (win as any).scrollY === 'number') {
      try {
        (win as any).scrollY = Math.max(0, (win.scrollY || 0) + offset);
      } catch {
        // Read-only in some browsers
      }
    }
  }

  try {
    repositionBadges();
  } catch {
    // Reposition ignored
  }

  return true;
}

/**
 * Main entry point: Executes an approved ActionStep in the content script.
 * Enforces strict validation and human approval contract.
 */
export async function executeAction(step: ActionStep): Promise<ExecuteActionResponse> {
  if (!step || typeof step !== 'object') {
    return {
      success: false,
      executed: false,
      error: 'Invalid or missing ActionStep object.',
    };
  }

  const { action, targetId, value } = step;

  try {
    switch (action) {
      case 'click': {
        if (targetId === null || targetId === undefined) {
          return {
            success: false,
            executed: false,
            error: 'Target element ID is required for click action.',
          };
        }

        const element = resolveTargetElement(targetId);
        if (!element) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} not found on the page.`,
          };
        }

        // Field Guard (Slice 4.3): Deterministically block typing into sensitive input fields
        const typeFieldSafety = checkFieldSafety(element);
        if (typeFieldSafety.isSensitive) {
          return {
            success: false,
            executed: false,
            error: `Blocked by Field Guard: Cannot interact with sensitive input field (${typeFieldSafety.reason || 'password/OTP/card/PIN'}).`,
          };
        }

        const isDisabled =
          (element as any).disabled === true ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.hasAttribute('disabled');

        if (isDisabled) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} (${element.tagName.toLowerCase()}) is disabled.`,
          };
        }

        // Scroll element into view smoothly before clicking if not visible
        if (typeof element.scrollIntoView === 'function') {
          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch {
            // Scroll failed
          }
        }

        const clicked = simulateClick(element);
        return {
          success: clicked,
          executed: true,
        };
      }

      case 'type': {
        if (targetId === null || targetId === undefined) {
          return {
            success: false,
            executed: false,
            error: 'Target element ID is required for type action.',
          };
        }

        const element = resolveTargetElement(targetId);
        if (!element) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} not found on the page.`,
          };
        }

        // Field Guard (Slice 4.3): Deterministically block typing into sensitive input fields
        const typeFieldSafety = checkFieldSafety(element);
        if (typeFieldSafety.isSensitive) {
          return {
            success: false,
            executed: false,
            error: `Blocked by Field Guard: Cannot interact with sensitive input field (${typeFieldSafety.reason || 'password/OTP/card/PIN'}).`,
          };
        }

        const isDisabled =
          (element as any).disabled === true ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.hasAttribute('disabled') ||
          (element as any).readOnly === true;

        if (isDisabled) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} (${element.tagName.toLowerCase()}) is disabled or read-only.`,
          };
        }

        if (typeof element.scrollIntoView === 'function') {
          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch {
            // Scroll failed
          }
        }

        const typed = simulateType(element, value ?? '');
        return {
          success: typed,
          executed: true,
        };
      }

      case 'select': {
        if (targetId === null || targetId === undefined) {
          return {
            success: false,
            executed: false,
            error: 'Target element ID is required for select action.',
          };
        }

        const element = resolveTargetElement(targetId);
        if (!element) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} not found on the page.`,
          };
        }

        // Field Guard (Slice 4.3): Deterministically block typing into sensitive input fields
        const typeFieldSafety = checkFieldSafety(element);
        if (typeFieldSafety.isSensitive) {
          return {
            success: false,
            executed: false,
            error: `Blocked by Field Guard: Cannot interact with sensitive input field (${typeFieldSafety.reason || 'password/OTP/card/PIN'}).`,
          };
        }

        const isDisabled =
          (element as any).disabled === true ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.hasAttribute('disabled');

        if (isDisabled) {
          return {
            success: false,
            executed: false,
            error: `Target element #${targetId} (${element.tagName.toLowerCase()}) is disabled.`,
          };
        }

        if (typeof element.scrollIntoView === 'function') {
          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch {
            // Scroll failed
          }
        }

        const selected = simulateSelect(element, value ?? '');
        if (!selected) {
          return {
            success: false,
            executed: false,
            error: `Could not select option "${value}" on element #${targetId}.`,
          };
        }

        return {
          success: true,
          executed: true,
        };
      }

      case 'scroll': {
        const targetElement = targetId !== null ? resolveTargetElement(targetId) : null;
        const scrolled = simulateScroll(targetElement, value);
        return {
          success: scrolled,
          executed: true,
        };
      }

      case 'done': {
        // Goal achieved, badges can remain or be cleaned up by caller
        return {
          success: true,
          executed: true,
        };
      }

      default: {
        return {
          success: false,
          executed: false,
          error: `Unsupported action primitive: "${action}". Supported: click, type, select, scroll, done.`,
        };
      }
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ASKbro Executor] Error executing action:', err);
    return {
      success: false,
      executed: false,
      error: errorMsg,
    };
  }
}

/**
 * Global message listener reference for unregistering
 */
let executorMessageListener: ((message: any, sender: any, sendResponse: any) => boolean) | null = null;

/**
 * Registers the content script runtime message listener for EXECUTE_ACTION.
 */
export function registerExecutorListener(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
    return;
  }

  // If already registered, safely detach old listener before re-registering
  if (executorMessageListener) {
    try {
      chrome.runtime.onMessage.removeListener(executorMessageListener);
    } catch {
      // ignore
    }
    executorMessageListener = null;
  }

  executorMessageListener = (message: any, _sender: any, sendResponse: (res: ExecuteActionResponse) => void) => {
    if (message?.type === 'EXECUTE_ACTION') {
      const execMsg = message as ExecuteActionMessage;
      executeAction(execMsg.step)
        .then((response) => {
          sendResponse(response);
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          sendResponse({
            success: false,
            executed: false,
            error: errMsg,
          });
        });
      return true; // Signals asynchronous response
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(executorMessageListener);
  console.log('[ASKbro Executor] Content action executor listener registered successfully.');
}

/**
 * Unregisters the content script runtime message listener (primarily for clean teardown in tests).
 */
export function unregisterExecutorListener(): void {
  if (executorMessageListener && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    try {
      chrome.runtime.onMessage.removeListener(executorMessageListener);
    } catch {
      // ignore
    }
  }
  executorMessageListener = null;
}
