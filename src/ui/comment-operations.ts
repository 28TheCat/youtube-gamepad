import type { CommentSnapshot } from '../../types/ports';

/** Shared thread pagination; each surface owns its focus and scroll position. */
export function createCommentOperations(port: {
  records(): readonly CommentSnapshot[];
  status(): { loading?: boolean; failed?: boolean } | undefined;
  replies(key: string): void;
}) {
  const state = { thread: '', limit: 5, nextIndex: undefined as number | undefined };
  return {
    state,
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
    translate(key: string, send: (key: string, target: string) => void) {
      const records = port.records();
      const item = records.find(item => item.key === key) || records.flatMap(item => item.replies).find(item => item.key === key);
      if (item?.translationTarget) send(key, item.translationTarget);
    }
  };
}
