export interface DrawerPosition { top: number; id: string; index: number }

/** Shared drawer lifecycle; surfaces supply their geometry and input owner. */
export function createDrawer(port: {
  element(): HTMLElement | undefined;
  content(): HTMLElement | undefined;
  activeElement(): HTMLElement | null;
  route(): string;
  items(): HTMLElement[];
  fallback?(): HTMLElement | undefined;
  index?(): number;
  opened?(modal: boolean): void;
  cleared(): void;
  restoreReturn?(target: HTMLElement | undefined, restore: boolean): void;
  restoreDetail?(position: DrawerPosition): void;
}) {
  let opened = false, route = '', target: HTMLElement | undefined;
  const details: { position: DrawerPosition; back(): void }[] = [];
  function items() {
    return port.items().filter(item => !item.closest('[hidden],[inert]') && !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true');
  }
  function focus(index = 0) {
    const choices = items(); choices[Math.max(0, Math.min(index, choices.length - 1))]?.focus({ preventScroll: true });
  }
  function backDetail() {
    if (!opened || route !== port.route()) return false;
    const detail = details.pop(); if (!detail) return false;
    detail.back();
    if (port.restoreDetail) port.restoreDetail(detail.position);
    else {
      const choices = items(), index = choices.findIndex(item => item.dataset.focusId === detail.position.id);
      focus(index >= 0 ? index : detail.position.index);
    }
    const content = port.content(); if (content) content.scrollTop = detail.position.top;
    return true;
  }
  function close(restore = true) {
    const apply = opened && restore && route === port.route(), previous = target;
    opened = false; target = undefined; details.length = 0;
    port.cleared();
    const element = port.element(); if (element) element.hidden = true;
    if (port.restoreReturn) port.restoreReturn(previous, apply);
    else if (apply && previous?.isConnected && !previous.closest('[hidden],[inert]') && !previous.hasAttribute('disabled')) previous.focus({ preventScroll: true });
  }
  return {
    items, focus, close, backDetail,
    back() { if (!backDetail()) close(); },
    clearDetails() { details.length = 0; },
    open(modal = true) {
      if (!opened || route !== port.route()) {
        target = port.activeElement() || port.fallback?.(); route = port.route(); opened = true;
      }
      details.length = 0; port.opened?.(modal);
      const element = port.element(); if (element) element.hidden = false;
    },
    enterDetail(back: () => void) {
      const active = port.activeElement(), choices = items(), index = active ? choices.indexOf(active) : -1;
      details.push({ back, position: { top: port.content()?.scrollTop || 0, id: active?.dataset.focusId || '', index: index >= 0 ? index : port.index?.() || 0 } });
    }
  };
}
