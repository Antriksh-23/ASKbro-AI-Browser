/**
 * DOM geometry and visibility checking utilities
 */

export function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) {
    return false;
  }

  return true;
}
