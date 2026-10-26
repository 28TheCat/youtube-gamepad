import type { Scope } from '../../types/ports';

/** Scroll one owning surface, including ancestors across our open shadow roots. */
export function createStickScroller(lifecycle: Scope) {
  let target: HTMLElement | null = null, snap = '', priority = '';
  function stop() {
    if (target) {
      if (snap) target.style.setProperty('scroll-snap-type', snap, priority);
      else target.style.removeProperty('scroll-snap-type');
    }
    target = null;
  }
  lifecycle.cleanup(stop);
  const parent = (node: Element): Element | null => node.parentElement || (node.getRootNode() as ShadowRoot).host || null;
  function contains(root: Document | HTMLElement, node: Element) {
    if (root === node.ownerDocument) return true;
    for (let current: Element | null = node; current; current = parent(current)) if (current === root) return true;
    return false;
  }
  function find(root: Document | HTMLElement, start: Element | null): HTMLElement | null {
    if (!start || !contains(root, start)) return null;
    for (let node: Element | null = start; node; node = parent(node)) {
      const element = node as HTMLElement;
      if (element.isConnected && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 && element.getClientRects().length) {
        const overflow = getComputedStyle(element).overflowY;
        if (/^(auto|scroll|overlay)$/.test(overflow) ||
          element === document.scrollingElement && !/^(hidden|clip)$/.test(overflow)) return element;
      }
      if (node === root) break;
    }
    return null;
  }
  return {
    stop,
    scroll(delta: number, root: Document | HTMLElement, origin: Element | null, fallback: Element | null = null) {
      if (!Number.isFinite(delta) || delta === 0) { stop(); return; }
      const next = find(root, origin) || find(root, fallback);
      if (next !== target) {
        stop(); target = next;
        if (target) {
          snap = target.style.getPropertyValue('scroll-snap-type');
          priority = target.style.getPropertyPriority('scroll-snap-type');
          target.style.setProperty('scroll-snap-type', 'none', 'important');
        }
      }
      // Reaching an inner surface's edge never scrolls its background.
      target?.scrollBy({ top: delta, behavior: 'instant' });
    }
  };
}
