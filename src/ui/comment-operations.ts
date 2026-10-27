import type { CommentSnapshot } from '../../types/ports';
import type { WatchPanelActions } from './mount-watch-panel';

/** Shared thread pagination; each surface owns its focus and scroll position. */
export function createCommentOperations(port: {
  records(): readonly CommentSnapshot[];
  status(): { loading?: boolean; failed?: boolean } | undefined;
  replies(key: string): void;
}) {
  const state = { thread: '', limit: 5, nextIndex: undefined as number | undefined };
  const operations = {
    state,
    canOpen(key: string) {
      return port.records().some(item => item.key === key && (item.hasReplies || item.replies.length > 0));
    },
    reset() { state.thread = ''; state.limit = 5; state.nextIndex = undefined; },
    open(key: string) {
      const record = port.records().find(item => item.key === key);
      if (!record || (!record.hasReplies && !record.replies.length)) return false;
      state.thread = key; state.limit = 5; state.nextIndex = undefined;
      if (!record.replies.length && record.hasReplies) port.replies(key);
      return true;
    },
    more() {
      if (port.status()?.loading) return false;
      const record = port.records().find(item => item.key === state.thread);
      if (!record) return false;
      state.nextIndex = Math.min(state.limit, record.replies.length);
      if (state.limit < record.replies.length) state.limit += 5;
      else if (record.hasReplies || port.status()?.failed) {
        state.limit = record.replies.length + 5; port.replies(state.thread);
      }
      return true;
    },
    callbacks(actions: {
      active(): boolean; changed(): void; openThread(key: string): void;
      load(): void; post(text: string, key?: string): Promise<unknown>;
      sort(value: 'TOP_COMMENTS' | 'NEWEST_FIRST'): unknown;
      translate(key: string, target: string): void;
    }): WatchPanelActions {
      return {
        openThread(key) { if (actions.active() && operations.canOpen(key)) actions.openThread(key); },
        replies() { if (actions.active() && operations.more()) actions.changed(); },
        load() { if (actions.active()) { actions.load(); actions.changed(); } },
        async postComment(text, key) {
          if (!actions.active()) return false;
          const ok = await actions.post(text, key);
          if (actions.active()) actions.changed();
          return ok === true;
        },
        sortComments(value) {
          if (!actions.active()) return false;
          const ok = actions.sort(value);
          actions.changed(); return ok === true;
        },
        translate(key) {
          if (!actions.active()) return;
          operations.translate(key, actions.translate); actions.changed();
        }
      };
    },
    translate(key: string, send: (key: string, target: string) => void) {
      const records = port.records();
      const item = records.find(item => item.key === key) || records.flatMap(item => item.replies).find(item => item.key === key);
      if (item?.translationTarget) send(key, item.translationTarget);
    }
  };
  return operations;
}
