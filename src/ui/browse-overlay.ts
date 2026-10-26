import { h, render } from 'vue';
import BrowseOverlay from './BrowseOverlay.vue';
import type { ControllerStyle } from '../../types/ports';
export interface BrowseOverlaySnapshot {
  visible: boolean; helpVisible: boolean; animate: boolean; adjusting: boolean;
  left: number; top: number; width: number; height: number; radius: string;
}
export interface BrowseOverlayPresenter { update(value: Partial<BrowseOverlaySnapshot>): void; destroy(): void }
export function mountBrowseOverlay(root: ShadowRoot, controllerStyle: ControllerStyle): BrowseOverlayPresenter {
  const container = document.createElement('div'); container.style.display = 'contents'; root.append(container);
  let view: BrowseOverlaySnapshot = { visible: false, helpVisible: false, animate: false, adjusting: false, left: 0, top: 0, width: 0, height: 0, radius: 'var(--ytg-card-radius, 14px)' };
  let disposed = false;
  const paint = () => render(h(BrowseOverlay, { view, controllerStyle }), container);
  paint();
  return {
    update(value) { if (!disposed) { view = { ...view, ...value }; paint(); } },
    destroy() { if (!disposed) { disposed = true; render(null, container); container.remove(); } }
  };
}
