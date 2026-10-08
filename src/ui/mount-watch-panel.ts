import { h, render } from 'vue';
import WatchPanel from './WatchPanel.vue';
import type { CommentSnapshot, ControllerStyle } from '../../types/ports';

export interface WatchPanelView {
  panel: 'description' | 'comments'; text: string; records: readonly CommentSnapshot[];
  collapsed: readonly string[]; unavailable: boolean;
}
export interface WatchPanelActions {
  toggle(key: string): void; replies(key: string): void; load(): void;
}
export function mountWatchPanel(container: HTMLElement, style: ControllerStyle, actions: WatchPanelActions) {
  let disposed = false;
  return {
    update(view: WatchPanelView) {
      if (!disposed) render(h(WatchPanel, { ...view, ...actions, controllerStyle: style }), container);
    },
    buttons() { return disposed ? [] : Array.from(container.querySelectorAll<HTMLElement>('button')).filter(button => !button.closest('[hidden]')); },
    dispose() { if (!disposed) { disposed = true; render(null, container); } }
  };
}
