import { Fragment, h, render } from 'vue';
import commentsCSS from './comments.css?inline';
import WatchPanel from './WatchPanel.vue';
import type { CommentSnapshot, CommentsStatus, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';

export interface WatchPanelView {
  panel: 'description' | 'comments' | 'playlists' | 'subscription'; text: string; descriptionRuns?: readonly import('../../types/core').DescriptionRun[]; records: readonly CommentSnapshot[];
  unavailable: boolean; thread?: CommentSnapshot; replyLimit?: number;
  commentsStatus?: CommentsStatus; commentRoute?: string;
  notificationPreference?: import('../../types/ports').NotificationPreference; subscriptionLoading?: boolean; subscriptionFailed?: boolean;
  playlists?: readonly SavedPlaylistSnapshot[]; playlistLoading?: boolean; playlistFailed?: boolean;
}
export interface WatchPanelActions {
  likeComment?(key: string): Promise<boolean>;
  openThread(key: string): void; replies(key?: string): void; load(): void;
  translate?(key: string): void;
  postComment?(text: string, key?: string): Promise<boolean>;
  sortComments?(sort: 'TOP_COMMENTS' | 'NEWEST_FIRST'): boolean;
  changed?(): void;
  subscriptionAction?(action: import('../../types/ports').WatchAction): void;
  savePlaylist?(key: string): void; retryPlaylists?(): void;
}
export function mountWatchPanel(container: HTMLElement, style: ControllerStyle, actions: WatchPanelActions, includeStyles = true) {
  let disposed = false;
  const changed = () => actions.changed?.();
  container.addEventListener('ytg-comment-controls-changed', changed);
  return {
    update(view: WatchPanelView) {
      if (!disposed) render(h(Fragment, [includeStyles ? h('style', commentsCSS) : null, h(WatchPanel, { ...view, ...actions, controllerStyle: style })]), container);
    },
    buttons() { return disposed ? [] : Array.from(container.querySelectorAll<HTMLElement>('button, textarea, a[href], .comment-text[tabindex]')).filter(button => !button.closest('[hidden]')); },
    dispose() { if (!disposed) { disposed = true; container.removeEventListener('ytg-comment-controls-changed', changed); render(null, container); } }
  };
}

export function backCommentComposer(container: HTMLElement) {
  const cancel = container.querySelector<HTMLButtonElement>('[data-comment-cancel]');
  if (!cancel) return false;
  if (!cancel.disabled) cancel.click();
  return true;
}
