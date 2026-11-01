/**
 * DOM geometry and visibility checking utilities
 */

/**
 * Checks whether an element is visible in the rendered document.
 * Filters out hidden elements:
 * - detached from DOM (!isConnected)
 * - hidden attribute or aria-hidden="true"
 * - display: none
 * - visibility: hidden or collapse
 * - opacity: 0
 * - width or height < minSize (default: 5px)
 */
export function isElementVisible(el: HTMLElement, minSize = 5): boolean {
  if (!el || !el.isConnected) return false;

  // HTML5 hidden or accessibility hidden
  if (el.hasAttribute('hidden')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none') {
        return false;
      }
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      if (style.opacity === '0' || parseFloat(style.opacity || '1') === 0) {
        return false;
      }
    } catch {
      // In non-browser or mock environments where getComputedStyle might throw
    }
  }

  if (typeof el.getBoundingClientRect === 'function') {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < minSize || rect.height < minSize) {
        return false;
      }
    } catch {
      // Bounding client rect not measurable
    }
  }

  return true;
}

/**
 * Checks whether a given bounding box is currently within the visible viewport bounds.
 */
export function isRectInViewport(
  rect: { top: number; left: number; bottom?: number; right?: number; width?: number; height?: number },
  viewport?: { width: number; height: number }
): boolean {
  const vpWidth = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vpHeight = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);

  const bottom = rect.bottom ?? (rect.top + (rect.height ?? 0));
  const right = rect.right ?? (rect.left + (rect.width ?? 0));

  if (bottom < 0 || rect.top > vpHeight) return false;
  if (right < 0 || rect.left > vpWidth) return false;

  return true;
}
