import { h, render } from 'vue';
import WatchPanel from './WatchPanel.vue';
import type { CommentSnapshot, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';

export interface WatchPanelView {
  panel: 'description' | 'comments' | 'playlists'; text: string; records: readonly CommentSnapshot[];
  unavailable: boolean; thread?: CommentSnapshot; replyLimit?: number;
  commentsStatus?: { loading: boolean; failed: boolean; hasMore: boolean };
  playlists?: readonly SavedPlaylistSnapshot[]; playlistLoading?: boolean; playlistFailed?: boolean;
}
export interface WatchPanelActions {
  openThread(key: string): void; replies(): void; load(): void;
  savePlaylist?(key: string): void; retryPlaylists?(): void;
}
export function mountWatchPanel(container: HTMLElement, style: ControllerStyle, actions: WatchPanelActions) {
  let disposed = false;
  return {
    update(view: WatchPanelView) {
      if (!disposed) render(h(WatchPanel, { ...view, ...actions, controllerStyle: style }), container);
    },
    buttons() { return disposed ? [] : Array.from(container.querySelectorAll<HTMLElement>('button, .comment-header[tabindex]')).filter(button => !button.closest('[hidden]')); },
    dispose() { if (!disposed) { disposed = true; render(null, container); } }
  };
}
