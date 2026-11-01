/**
 * ASKbro In-Page Selection & Highlight Handler
 *
 * Implements:
 * 1. Right-button mouse drag text selection support:
 *    Allows users to highlight text by dragging with the right mouse button (button 2).
 * 2. Floating "💡 Explain" Quick Action Pill:
 *    When text is highlighted on any webpage, renders an unobtrusive, closed Shadow DOM
 *    floating pill near the selection that lets users instantly explain the section.
 * 3. Dispatches EXPLAIN_HIGHLIGHTED_TEXT to Service Worker to open the side panel
 *    and trigger real-time AI explanation in the Explain Section.
 */

export const SELECTION_HOST_ID = 'askbro-selection-pill-root';

let hostElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let pillButton: HTMLButtonElement | null = null;
let isSelectionListenerRegistered = false;

// Right-click drag tracking state
let isRightMouseDown = false;
let rightStartX = 0;
let rightStartY = 0;
let startCaretRange: Range | null = null;
let hasRightDragged = false;

/**
 * Initializes and mounts closed Shadow DOM host for floating Explain pill
 */
function ensureShadowOverlay(): ShadowRoot | null {
  if (typeof document === 'undefined') return null;

  if (shadowRoot && hostElement && hostElement.isConnected) {
    return shadowRoot;
  }

  // Remove stale host if any
  const existing = document.getElementById(SELECTION_HOST_ID);
  if (existing) {
    existing.remove();
  }

  hostElement = document.createElement('div');
  hostElement.id = SELECTION_HOST_ID;
  hostElement.style.cssText =
    'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; border: none !important; margin: 0 !important; padding: 0 !important;';

  try {
    shadowRoot = hostElement.attachShadow({ mode: 'closed' });
  } catch {
    return null;
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    }

    .askbro-floating-pill {
      position: fixed !important;
      transform: translate(-50%, -100%) !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 5px 10px !important;
      background: #121417 !important;
      color: #E0E3E8 !important;
      border: 1px solid #343B45 !important;
      border-radius: 4px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(212, 255, 0, 0.15) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      letter-spacing: 0.02em !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      user-select: none !important;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
      opacity: 0 !important;
      visibility: hidden !important;
      z-index: 2147483647 !important;
      white-space: nowrap !important;
    }

    .askbro-floating-pill.visible {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translate(-50%, -100%) translateY(-6px) !important;
    }

    .askbro-floating-pill:hover {
      background: #1A1D23 !important;
      border-color: #D4FF00 !important;
      color: #FFFFFF !important;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6), 0 0 8px rgba(212, 255, 0, 0.3) !important;
    }

    .askbro-pill-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      color: #F59E0B !important;
      font-size: 12px !important;
      line-height: 1 !important;
    }

    .askbro-pill-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 9px !important;
      font-weight: 700 !important;
      text-transform: uppercase !important;
      color: #0C0D0E !important;
      background: #D4FF00 !important;
      padding: 1px 4px !important;
      border-radius: 2px !important;
      margin-left: 2px !important;
      line-height: 1.2 !important;
    }
  `;

  shadowRoot.appendChild(styleEl);

  pillButton = document.createElement('button');
  pillButton.type = 'button';
  pillButton.className = 'askbro-floating-pill';
  pillButton.innerHTML = `
    <span class="askbro-pill-icon">💡</span>
    <span>Explain</span>
    <span class="askbro-pill-badge">ASKbro</span>
  `;

  pillButton.addEventListener('mousedown', (e) => {
    // Prevent button click from clearing webpage text selection
    e.preventDefault();
    e.stopPropagation();
  });

  pillButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerExplainSelection();
  });

  shadowRoot.appendChild(pillButton);
  document.documentElement.appendChild(hostElement);

  return shadowRoot;
}

/**
 * Hides the floating Explain pill
 */
export function hideFloatingPill(): void {
  if (pillButton) {
    pillButton.classList.remove('visible');
  }
}

/**
 * Triggers Explain action for current webpage selection
 */
export function triggerExplainSelection(textOverride?: string): void {
  if (typeof window === 'undefined') return;

  const selectedText = (textOverride || window.getSelection()?.toString() || '').trim();
  if (!selectedText) {
    hideFloatingPill();
    return;
  }

  hideFloatingPill();

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime
      .sendMessage({
        type: 'EXPLAIN_HIGHLIGHTED_TEXT',
        payload: {
          selectedText,
          pageTitle: document.title,
          pageUrl: window.location.href,
        },
      })
      .catch((err) => {
        console.debug('[ASKbro Selection] Notice triggering explain:', err);
      });
  }
}

/**
 * Shows and positions floating Explain pill relative to the current selection
 */
function updatePillPosition(): void {
  if (typeof window === 'undefined') return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideFloatingPill();
    return;
  }

  const selectedText = selection.toString().trim();
  // Filter out tiny or excessively massive selections
  if (selectedText.length < 2 || selectedText.length > 25000) {
    hideFloatingPill();
    return;
  }

  // Check if active element is an input password or sensitive field
  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLInputElement && activeEl.type === 'password') {
    hideFloatingPill();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    hideFloatingPill();
    return;
  }

  ensureShadowOverlay();
  if (!pillButton) return;

  // Calculate coordinates: center above selection, with viewport boundary guards
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const rawX = rect.left + rect.width / 2;
  const clampedX = Math.max(70, Math.min(viewportWidth - 70, rawX));

  let topY = rect.top;
  // If selection is too close to top of viewport, position below selection instead
  if (topY < 50) {
    topY = rect.bottom + 38;
    pillButton.style.transform = 'translate(-50%, 0) translateY(4px)';
  } else {
    pillButton.style.transform = 'translate(-50%, -100%) translateY(-6px)';
  }

  pillButton.style.left = `${Math.round(clampedX)}px`;
  pillButton.style.top = `${Math.round(topY)}px`;
  pillButton.classList.add('visible');
}

/**
 * Cross-browser caret range resolver from viewport point
 */
function getCaretRangeFromCoordinates(clientX: number, clientY: number): Range | null {
  if (typeof document === 'undefined') return null;

  if (typeof (document as any).caretRangeFromPoint === 'function') {
    return (document as any).caretRangeFromPoint(clientX, clientY);
  }

  if (typeof (document as any).caretPositionFromPoint === 'function') {
    const pos = (document as any).caretPositionFromPoint(clientX, clientY);
    if (pos && pos.offsetNode) {
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  }

  return null;
}

/**
 * Registers all mouse, selection, and drag handlers
 */
export function registerSelectionListener(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (isSelectionListenerRegistered) {
    return;
  }
  isSelectionListenerRegistered = true;

  // 1. Right-Mouse Button Drag-to-Select Support
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 2) {
        // Right mouse button pressed
        isRightMouseDown = true;
        hasRightDragged = false;
        rightStartX = e.clientX;
        rightStartY = e.clientY;
        startCaretRange = getCaretRangeFromCoordinates(e.clientX, e.clientY);
      } else if (e.button === 0) {
        // Left click outside hides floating pill if not clicking inside host
        if (hostElement && !hostElement.contains(e.target as Node)) {
          hideFloatingPill();
        }
      }
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    'mousemove',
    (e) => {
      // If right button is held and dragged
      if (isRightMouseDown && (e.buttons & 2) && startCaretRange) {
        const deltaX = Math.abs(e.clientX - rightStartX);
        const deltaY = Math.abs(e.clientY - rightStartY);

        if (deltaX > 8 || deltaY > 8) {
          hasRightDragged = true;
          const currentCaret = getCaretRangeFromCoordinates(e.clientX, e.clientY);

          if (currentCaret) {
            const selection = window.getSelection();
            if (selection) {
              const newRange = document.createRange();
              try {
                const comparison = startCaretRange.compareBoundaryPoints(
                  Range.START_TO_START,
                  currentCaret
                );
                if (comparison <= 0) {
                  newRange.setStart(startCaretRange.startContainer, startCaretRange.startOffset);
                  newRange.setEnd(currentCaret.startContainer, currentCaret.startOffset);
                } else {
                  newRange.setStart(currentCaret.startContainer, currentCaret.startOffset);
                  newRange.setEnd(startCaretRange.startContainer, startCaretRange.startOffset);
                }
                selection.removeAllRanges();
                selection.addRange(newRange);
              } catch {
                // Ignore DOM comparison edge cases across iframes or closed shadow boundaries
              }
            }
          }
        }
      }
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button === 2) {
        isRightMouseDown = false;
        startCaretRange = null;
      }

      // Small delay to allow browser to settle window.getSelection()
      setTimeout(() => {
        updatePillPosition();
      }, 20);
    },
    { capture: true, passive: true }
  );

  // 2. Selection Change & Scroll / Resize Handling
  document.addEventListener('selectionchange', () => {
    // Debounce position updates
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          hideFloatingPill();
        }
      });
    }
  });

  window.addEventListener('scroll', () => hideFloatingPill(), { passive: true });
  window.addEventListener('resize', () => hideFloatingPill(), { passive: true });

  console.log('[ASKbro Selection] Registered text selection and right-mouse highlight listener.');
}

