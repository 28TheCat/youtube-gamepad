import { commentLanguage } from '../shared/comment-language';

type Node = Record<string, any>;
export interface NativeCommentTranslation { language: string; action: string }

// Decode only action type and target; no language inference or entity-key guesses.
function actionLanguage(action: unknown): string | undefined {
  if (typeof action !== 'string' || !action || action.length > 20000) return;
  try {
    const bytes = Uint8Array.from(atob(decodeURIComponent(action).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    function fields(data: Uint8Array) {
      const result = new Map<number, number | Uint8Array>();
      let cursor = 0;
      function integer() {
        let value = 0;
        for (let shift = 0; shift < 35 && cursor < data.length; shift += 7) {
          const byte = data[cursor++]; value += (byte & 127) * 2 ** shift;
          if (!(byte & 128)) return value;
        }
        throw new Error('Invalid comment action');
      }
      while (cursor < data.length) {
        const tag = integer(), field = Math.floor(tag / 8), wire = tag % 8;
        if (!field) throw new Error('Invalid comment action');
        if (wire === 0) result.set(field, integer());
        else if (wire === 2) {
          const size = integer(), start = cursor, end = start + size;
          if (end > data.length) throw new Error('Invalid comment action');
          result.set(field, data.subarray(start, end)); cursor = end;
        } else if (wire === 1 || wire === 5) {
          cursor += wire === 1 ? 8 : 4;
          if (cursor > data.length) throw new Error('Invalid comment action');
        } else throw new Error('Invalid comment action');
      }
      return result;
    }
    const actionFields = fields(bytes);
    if (actionFields.get(1) !== 22) return;
    const translate = actionFields.get(31);
    if (!(translate instanceof Uint8Array)) return;
    const language = fields(translate).get(4);
    if (language instanceof Uint8Array) return commentLanguage(new TextDecoder('utf-8', { fatal: true }).decode(language));
  } catch { /* Unsupported native actions do not create a translation button. */ }
}

function findTranslation(root: unknown, commentId: string): NativeCommentTranslation | undefined {
  const pending = [root];
  let budget = 1000;
  while (pending.length && budget-- > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (typeof (value as Node).commentId === 'string' && (value as Node).commentId !== commentId) continue;
    const endpoint = (value as Node).performCommentActionEndpoint;
    const actions = Array.isArray(endpoint?.actions) ? endpoint.actions : endpoint?.action ? [endpoint.action] : [];
    for (const action of actions) {
      const language = actionLanguage(action);
      if (language) return { language, action };
    }
    pending.push(...Object.values(value));
  }
}

export function nativeCommentTranslations(raw: Node): Map<string, NativeCommentTranslation | undefined> {
  const entities = new Map<string, Node>();
  for (const mutation of raw.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
    for (const payload of Object.values(mutation.payload || {}) as Node[]) {
      const key = payload?.key || mutation.entityKey;
      if (typeof key === 'string') entities.set(key, payload);
    }
  }
  const result = new Map<string, NativeCommentTranslation | undefined>();
  const pending: unknown[] = [raw.onResponseReceivedEndpoints, raw.onResponseReceivedActions, raw.onResponseReceivedCommands,
    raw.contents, raw.continuationContents];
  let budget = 20000;
  while (pending.length && budget-- > 0) {
    const node = pending.pop() as Node | undefined;
    if (!node || typeof node !== 'object') continue;
    if (typeof node.commentId === 'string' && node.commentId.length <= 200) {
      const comment = entities.get(node.commentKey);
      const candidates = [node, comment, entities.get(node.commentSurfaceKey),
        entities.get(comment?.properties?.translateButtonEntityKey)];
      result.set(node.commentId, candidates.map(value => findTranslation(value, node.commentId)).find(Boolean));
    }
    pending.push(...Object.values(node));
  }
  return result;
}
