/**
 * ASKbro Closed Shadow DOM Badge Overlay (Slice 3.1)
 *
 * Injects a non-destructive closed Shadow DOM overlay (#askbro-badge-root)
 * containing floating badge pills positioned via getBoundingClientRect().
 * Automatically recalculates badge positions on window scroll and resize.
 */

import { isRectInViewport } from '../utils/domUtils';

export interface TrackedBadgeItem {
  id: number;
  element: HTMLElement;
  badgeEl: HTMLElement;
}

export const BADGE_ROOT_ID = 'askbro-badge-root';

/**
 * Internal state for closed shadow root and active badges
 */
let badgeHost: HTMLElement | null = null;
let closedShadowRoot: ShadowRoot | null = null;
let trackedBadges: TrackedBadgeItem[] = [];
let scrollResizeListenerAttached = false;
let rafHandle: number | null = null;
let activeHighlightTimer: ReturnType<typeof setTimeout> | null = null;
let activeHighlightedId: number | null = null;
let highlightBoxEl: HTMLElement | null = null;

/**
 * Dynamic SPA DOM MutationObserver state
 */
let domMutationObserver: MutationObserver | null = null;
let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let onDomMutationCallback: (() => void) | null = null;

/**
 * Cross-environment safe requestAnimationFrame
 */
function scheduleReposition(): void {
  if (rafHandle !== null) return;

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = null;
      repositionBadges();
    });
  } else {
    rafHandle = setTimeout(() => {
      rafHandle = null;
      repositionBadges();
    }, 16) as unknown as number;
  }
}

/**
 * Safe cancel for animation frame or timeout
 */
function cancelScheduledReposition(): void {
  if (rafHandle === null) return;
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(rafHandle);
  } else {
    clearTimeout(rafHandle);
  }
  rafHandle = null;
}

/**
 * Styles for closed Shadow DOM badge overlay.
 * Uses strict all: initial !important and scoped reset to ensure complete immunity
 * from host site CSS collisions and inherited styling rules.
 */
const OVERLAY_STYLES = `
:host {
  all: initial !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  pointer-events: none !important;
  z-index: 2147483647 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  overflow: hidden !important;
}

.askbro-overlay-container {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
}

.askbro-badge-pill {
  position: fixed !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 18px !important;
  height: 18px !important;
  padding: 0 4px !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  line-height: 1 !important;
  letter-spacing: 0.02em !important;
  text-transform: none !important;
  text-decoration: none !important;
  text-align: center !important;
  color: #E0E3E8 !important;
  background: #0C0D0E !important;
  border: 1px solid #343B45 !important;
  border-radius: 2px !important;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
  pointer-events: none !important;
  user-select: none !important;
  z-index: 2147483647 !important;
  transform: translate(-50%, -50%) !important;
  transition: transform 0.12s ease-out, background 0.15s ease, box-shadow 0.15s ease !important;
  will-change: top, left, transform !important;
}

.askbro-badge-pill.askbro-highlighted {
  background: #D4FF00 !important;
  border: 1px solid #E4FF33 !important;
  color: #0C0D0E !important;
  transform: translate(-50%, -50%) scale(1.35) !important;
  box-shadow: 0 0 16px rgba(212, 255, 0, 0.75), 0 0 24px rgba(212, 255, 0, 0.4) !important;
  animation: askbro-badge-pulse 1.2s infinite ease-in-out !important;
}

.askbro-element-highlight-box {
  position: fixed !important;
  border: 2px solid #D4FF00 !important;
  background: rgba(212, 255, 0, 0.08) !important;
  border-radius: 2px !important;
  box-shadow: 0 0 14px rgba(212, 255, 0, 0.4), inset 0 0 10px rgba(212, 255, 0, 0.12) !important;
  pointer-events: none !important;
  z-index: 2147483646 !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
  transition: all 0.15s ease-out !important;
  display: none;
}

@keyframes askbro-badge-pulse {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1.35);
    box-shadow: 0 0 16px rgba(212, 255, 0, 0.75), 0 0 24px rgba(212, 255, 0, 0.4);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.48);
    box-shadow: 0 0 22px rgba(212, 255, 0, 0.95), 0 0 32px rgba(212, 255, 0, 0.6);
  }
}
`;

/**
 * Initializes or returns the existing closed Shadow DOM root on document
 */
function ensureShadowOverlay(): { host: HTMLElement; shadow: ShadowRoot; container: HTMLElement } {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) {
    throw new Error('Document is not available');
  }

  // Check if existing host is already attached to DOM
  let host = doc.getElementById(BADGE_ROOT_ID) as HTMLElement | null;
  let shadow = closedShadowRoot;

  if (!host || !shadow) {
    // If old detached host existed, clean it up
    if (host) {
      host.remove();
    }

    host = doc.createElement('div');
    host.id = BADGE_ROOT_ID;
    host.setAttribute('data-askbro-root', 'true');
    host.style.cssText =
      'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; pointer-events: none !important; z-index: 2147483647 !important; margin: 0 !important; padding: 0 !important; border: none !important; background: transparent !important; overflow: hidden !important;';

    // Closed shadow DOM prevents page scripts from reading or tampering with badge elements
    shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = doc.createElement('style');
    styleEl.textContent = OVERLAY_STYLES;
    shadow.appendChild(styleEl);

    const container = doc.createElement('div');
    container.className = 'askbro-overlay-container';
    shadow.appendChild(container);

    const highlightBox = doc.createElement('div');
    highlightBox.className = 'askbro-element-highlight-box';
    container.appendChild(highlightBox);
    highlightBoxEl = highlightBox;

    const mountTarget = doc.documentElement || doc.body;
    mountTarget.appendChild(host);

    badgeHost = host;
    closedShadowRoot = shadow;
  }

  const container = shadow.querySelector('.askbro-overlay-container') as HTMLElement;
  return { host, shadow, container };
}

/**
 * Event handler for scroll and resize
 */
function onWindowScrollOrResize(): void {
  scheduleReposition();
}

/**
 * Attaches passive scroll, resize, and dynamic SPA MutationObserver listeners
 */
function attachListeners(): void {
  if (!scrollResizeListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('scroll', onWindowScrollOrResize, { passive: true, capture: true });
    window.addEventListener('resize', onWindowScrollOrResize, { passive: true });
    scrollResizeListenerAttached = true;
  }

  // Attach dynamic SPA MutationObserver
  attachMutationObserver();
}

/**
 * Detaches scroll, resize, and dynamic SPA MutationObserver listeners
 */
function detachListeners(): void {
  if (scrollResizeListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('scroll', onWindowScrollOrResize, true);
    window.removeEventListener('resize', onWindowScrollOrResize);
    scrollResizeListenerAttached = false;
    cancelScheduledReposition();
  }

  // Detach dynamic SPA MutationObserver
  detachMutationObserver();
}

/**
 * Updates positions of all active badge pills and highlight box based on getBoundingClientRect()
 */
export function repositionBadges(): void {
  if (trackedBadges.length === 0) return;

  for (const item of trackedBadges) {
    if (!item.element || !item.element.isConnected) {
      item.badgeEl.style.display = 'none';
      continue;
    }

    try {
      const rect = item.element.getBoundingClientRect();
      const inView = isRectInViewport(rect);

      if (!inView || (rect.width === 0 && rect.height === 0)) {
        item.badgeEl.style.display = 'none';
      } else {
        item.badgeEl.style.display = 'inline-flex';
        item.badgeEl.style.top = `${Math.max(2, Math.round(rect.top))}px`;
        item.badgeEl.style.left = `${Math.max(2, Math.round(rect.left))}px`;
      }
    } catch {
      item.badgeEl.style.display = 'none';
    }
  }

  // Update active element highlight box position if visible
  if (activeHighlightedId !== null && highlightBoxEl) {
    const current = trackedBadges.find((t) => t.id === activeHighlightedId);
    if (current && current.element.isConnected) {
      try {
        const rect = current.element.getBoundingClientRect();
        highlightBoxEl.style.top = `${Math.round(rect.top)}px`;
        highlightBoxEl.style.left = `${Math.round(rect.left)}px`;
        highlightBoxEl.style.width = `${Math.round(rect.width)}px`;
        highlightBoxEl.style.height = `${Math.round(rect.height)}px`;
      } catch {
        highlightBoxEl.style.display = 'none';
      }
    } else {
      highlightBoxEl.style.display = 'none';
    }
  }
}

/**
 * Renders floating badge pills for the provided elements into the closed Shadow DOM overlay
 */
export function renderBadges(
  elementsWithIds: Array<{ id: number; element: HTMLElement }>
): void {
  if (typeof document === 'undefined') return;

  const { container } = ensureShadowOverlay();

  // Clear existing badge pills inside overlay container (retaining highlight box)
  const existingBadges = container.querySelectorAll('.askbro-badge-pill');
  existingBadges.forEach((b) => b.remove());

  trackedBadges = [];

  for (const { id, element } of elementsWithIds) {
    if (!element) continue;

    const badge = document.createElement('div');
    badge.className = 'askbro-badge-pill';
    badge.setAttribute('data-badge-id', String(id));
    badge.textContent = String(id);

    try {
      const rect = element.getBoundingClientRect();
      const inView = isRectInViewport(rect);

      if (!inView || (rect.width === 0 && rect.height === 0)) {
        badge.style.display = 'none';
      } else {
        badge.style.display = 'inline-flex';
        badge.style.top = `${Math.max(2, Math.round(rect.top))}px`;
        badge.style.left = `${Math.max(2, Math.round(rect.left))}px`;
      }
    } catch {
      badge.style.display = 'none';
    }

    container.appendChild(badge);
    trackedBadges.push({ id, element, badgeEl: badge });
  }

  attachListeners();
}

/**
 * Highlights a target badge pill and outlines the element with a glowing cyan box.
 * Automatically scrolls the element into view.
 *
 * @param id The target element/badge ID
 * @param durationMs Duration in ms before highlight fades (default: 2500ms)
 * @returns true if target was found and highlighted, false otherwise
 */
export function highlightElement(id: number, durationMs = 2500): boolean {
  const item = trackedBadges.find((t) => t.id === id);
  if (!item || !item.element.isConnected) {
    return false;
  }

  // Clear previous timer and highlight
  removeHighlight();

  activeHighlightedId = id;

  // 1. Add highlight class to badge pill
  item.badgeEl.classList.add('askbro-highlighted');
  item.badgeEl.style.display = 'inline-flex';

  // 2. Smoothly scroll target element into viewport center
  try {
    if (typeof item.element.scrollIntoView === 'function') {
      item.element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  } catch {
    // scrollIntoView unsupported or blocked
  }

  // 3. Position and show element highlight box
  if (highlightBoxEl) {
    try {
      const rect = item.element.getBoundingClientRect();
      highlightBoxEl.style.top = `${Math.round(rect.top)}px`;
      highlightBoxEl.style.left = `${Math.round(rect.left)}px`;
      highlightBoxEl.style.width = `${Math.round(rect.width)}px`;
      highlightBoxEl.style.height = `${Math.round(rect.height)}px`;
      highlightBoxEl.style.display = 'block';
    } catch {
      highlightBoxEl.style.display = 'none';
    }
  }

  // Reposition badge immediately
  repositionBadges();

  // 4. Set auto-dismiss timer
  if (durationMs > 0) {
    activeHighlightTimer = setTimeout(() => {
      removeHighlight();
    }, durationMs);
  }

  return true;
}

/**
 * Clears active pulse and element outline highlight
 */
export function removeHighlight(): void {
  if (activeHighlightTimer) {
    clearTimeout(activeHighlightTimer);
    activeHighlightTimer = null;
  }

  if (activeHighlightedId !== null) {
    const item = trackedBadges.find((t) => t.id === activeHighlightedId);
    if (item && item.badgeEl) {
      item.badgeEl.classList.remove('askbro-highlighted');
    }
    activeHighlightedId = null;
  }

  if (highlightBoxEl) {
    highlightBoxEl.style.display = 'none';
  }
}

/**
 * Scans active tracked badges and prunes elements that have been removed or disconnected from the DOM.
 * Returns the count of pruned stale badges.
 */
export function invalidateAndPruneBadges(): number {
  const initialCount = trackedBadges.length;
  const surviving: TrackedBadgeItem[] = [];

  for (const item of trackedBadges) {
    if (!item.element || !item.element.isConnected) {
      if (item.badgeEl) {
        item.badgeEl.style.display = 'none';
        item.badgeEl.remove();
      }
    } else {
      surviving.push(item);
    }
  }

  trackedBadges = surviving;
  return initialCount - surviving.length;
}

/**
 * Processes dynamic SPA DOM mutations, ignoring internal changes within ASKbro badge root
 */
function handleDomMutation(mutations?: MutationRecord[]): void {
  if (mutations && mutations.length > 0) {
    // Check if ALL mutations are internal to ASKbro root
    const allInternal = mutations.every((m) => {
      const target = m.target as HTMLElement;
      return (
        target?.id === BADGE_ROOT_ID ||
        target?.closest?.(`#${BADGE_ROOT_ID}`) ||
        target?.hasAttribute?.('data-askbro-root')
      );
    });

    if (allInternal) return;
  }

  // Debounce DOM re-evaluation
  if (mutationDebounceTimer !== null) {
    clearTimeout(mutationDebounceTimer);
  }

  mutationDebounceTimer = setTimeout(() => {
    mutationDebounceTimer = null;
    triggerDomMutationCheck();
  }, 80);
}

/**
 * Executes an immediate DOM mutation reconciliation:
 * Prunes disconnected badge elements, recalculates badge coordinates,
 * and calls the registered SPA mutation callback if present.
 */
export function triggerDomMutationCheck(): void {
  invalidateAndPruneBadges();
  repositionBadges();
  if (onDomMutationCallback) {
    try {
      onDomMutationCallback();
    } catch (err) {
      console.debug('[ASKbro Badges] Error in onDomMutationCallback:', err);
    }
  }
}

/**
 * Attaches a MutationObserver to the host page DOM to detect dynamic SPA changes
 */
export function attachMutationObserver(root?: Node): void {
  if (domMutationObserver !== null || typeof window === 'undefined') return;

  const ObserverCtor =
    (window as any).MutationObserver ||
    (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  if (!ObserverCtor) return;

  const target =
    root ||
    (typeof document !== 'undefined'
      ? document.body || document.documentElement
      : null);

  if (!target) return;

  try {
    const observer = new ObserverCtor((mutations: MutationRecord[]) => {
      handleDomMutation(mutations);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'disabled'],
    });

    domMutationObserver = observer;
  } catch (err) {
    console.debug('[ASKbro Badges] Could not attach MutationObserver:', err);
  }
}

/**
 * Detaches the MutationObserver and cancels pending debounce timers
 */
export function detachMutationObserver(): void {
  if (mutationDebounceTimer !== null) {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = null;
  }

  if (domMutationObserver !== null) {
    try {
      domMutationObserver.disconnect();
    } catch {
      // ignore
    }
    domMutationObserver = null;
  }
}

/**
 * Sets callback to be invoked when dynamic DOM mutations occur
 */
export function setOnDomMutationCallback(cb: (() => void) | null): void {
  onDomMutationCallback = cb;
}

/**
 * Returns whether MutationObserver is actively observing DOM mutations
 */
export function isMutationObserverActive(): boolean {
  return domMutationObserver !== null;
}

/**
 * Verifies that the badge root is mounted in closed Shadow DOM mode
 */
export function verifyShadowIsolation(): {
  isClosedShadow: boolean;
  hostMounted: boolean;
  shadowMode: 'closed' | 'open' | 'none';
} {
  const host = typeof document !== 'undefined' ? document.getElementById(BADGE_ROOT_ID) : null;
  const isClosed = closedShadowRoot !== null;
  const hostMounted = host !== null && host.isConnected;
  const shadowMode = isClosed ? 'closed' : host?.shadowRoot ? 'open' : 'none';

  return {
    isClosedShadow: isClosed,
    hostMounted,
    shadowMode,
  };
}

/**
 * Removes all badges, detaches event listeners, and removes the Shadow DOM host
 */
export function removeBadges(): void {
  detachListeners();
  removeHighlight();

  if (badgeHost) {
    badgeHost.remove();
    badgeHost = null;
  }

  closedShadowRoot = null;
  highlightBoxEl = null;
  trackedBadges = [];
  onDomMutationCallback = null;
}

/**
 * Returns current badge host DOM node if mounted
 */
export function getBadgeOverlayHost(): HTMLElement | null {
  return badgeHost;
}

/**
 * Returns true if badges are currently active and mounted
 */
export function isBadgesActive(): boolean {
  return badgeHost !== null && trackedBadges.length > 0;
}

/**
 * Returns the currently tracked items (useful for inspection/tests)
 */
export function getTrackedBadges(): readonly TrackedBadgeItem[] {
  return trackedBadges;
}

