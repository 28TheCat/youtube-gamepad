import { Fragment, h, render } from 'vue';
import commentsCSS from './comments.css?inline';
import WatchPanel from './WatchPanel.vue';
import type { CommentSnapshot, CommentsStatus, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';

export interface WatchPanelView {
  panel: 'description' | 'comments' | 'playlists' | 'subscription'; text: string; records: readonly CommentSnapshot[];
  unavailable: boolean; thread?: CommentSnapshot; replyLimit?: number;
  commentsStatus?: CommentsStatus; commentRoute?: string;
  notificationPreference?: import('../../types/ports').NotificationPreference; subscriptionLoading?: boolean; subscriptionFailed?: boolean;
  playlists?: readonly SavedPlaylistSnapshot[]; playlistLoading?: boolean; playlistFailed?: boolean;
}
export interface WatchPanelActions {
  openThread(key: string): void; replies(): void; load(): void;
  translate?(key: string): void;
  postComment?(text: string, key?: string): Promise<boolean>;
  sortComments?(sort: 'TOP_COMMENTS' | 'NEWEST_FIRST'): boolean;
  changed?(): void;
  subscriptionAction?(action: import('../../types/ports').WatchAction): void;
  savePlaylist?(key: string): void; retryPlaylists?(): void;
}
export function mountWatchPanel(container: HTMLElement, style: ControllerStyle, actions: WatchPanelActions) {
  let disposed = false;
  const changed = () => actions.changed?.();
  container.addEventListener('ytg-comment-controls-changed', changed);
  return {
    update(view: WatchPanelView) {
      if (!disposed) render(h(Fragment, [h('style', commentsCSS), h(WatchPanel, { ...view, ...actions, controllerStyle: style })]), container);
    },
    buttons() { return disposed ? [] : Array.from(container.querySelectorAll<HTMLElement>('button, textarea, .comment-text[tabindex]')).filter(button => !button.closest('[hidden]')); },
    dispose() { if (!disposed) { disposed = true; container.removeEventListener('ytg-comment-controls-changed', changed); render(null, container); } }
  };
}

export function backCommentComposer(container: HTMLElement) {
  const cancel = container.querySelector<HTMLButtonElement>('[data-comment-cancel]');
  if (!cancel) return false;
  if (!cancel.disabled) cancel.click();
  return true;
}
