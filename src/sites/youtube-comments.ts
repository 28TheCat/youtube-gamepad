import { createYouTubeHeaders, requestYouTube } from './youtube-request';
import { Innertube, Session, Parser } from 'youtubei.js/web';
import type { YT, YTNodes } from 'youtubei.js/web';
import type { CommentSnapshot, CommentReplySnapshot } from '../../types/ports';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { PAGE_COMMENTS } from '../bridge/page-protocol';

export interface CommentsSnapshot {
  route: string; items: CommentSnapshot[]; loading: boolean; failed: boolean; hasMore: boolean;
}
type ReplyCursor = { replies?: Iterable<YTNodes.CommentThread>; has_continuation: boolean;
  getContinuation(): Promise<ReplyCursor> };
type ThreadState = { thread: YTNodes.CommentThread; cursor?: ReplyCursor; replies: Map<string, CommentReplySnapshot> };
Parser.setParserErrorHandler(() => {});

// All library instances, credentials and continuation endpoints remain in MAIN.
export function createCommentsService() {
  let state: CommentsSnapshot = { route: '', items: [], loading: false, failed: false, hasMore: true };
  let page: YT.Comments | undefined, api: Innertube | undefined;
  let pending: AbortController | undefined, destroyed = false, initialized = false, emptyPages = 0;
  let failedKey: string | undefined;
  const threads = new Map<string, ThreadState>();
  const route = () => location.pathname + location.search;
  function notify() { if (!destroyed) document.dispatchEvent(new Event(PAGE_COMMENTS)); }
  function syncRoute() {
    if (state.route === route()) return;
    pending?.abort(); pending = undefined; page = undefined; api = undefined;
    initialized = false; failedKey = undefined; emptyPages = 0; threads.clear();
    state = { route: route(), items: [], loading: false, failed: false, hasMore: true };
  }
  async function send(continuation: string) {
    const captured = state, controller = pending;
    if (!controller || controller.signal.aborted || captured.route !== route()) throw new Error('Comments cancelled');
    const config = (key: string) => (window as any).ytcfg?.get?.(key);
    const context = config('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const headers = await createYouTubeHeaders(context);
    const raw = await requestYouTube('next', { method: 'POST', credentials: 'same-origin', headers,
      body: JSON.stringify({ context, continuation }), signal: controller.signal });
    if (destroyed || captured !== state || captured.route !== route() || controller.signal.aborted) throw new Error('Comments cancelled');
    return raw;
  }
  function client() {
    if (api) return api;
    const context = (window as any).ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const session = new Session(structuredClone({ ...context, user: context.user || {} }), '', 'v1', 0,
      undefined, undefined, undefined, async () => {
        throw new Error('Unexpected network request from comments parser');
      });
    // Keep the library's comment/reply cursors and initial token generation,
    // but connect their actions directly to our JSON transport. No synthetic
    // fetch, request-body round trip or Response serialization is needed.
    session.actions.execute = (async (endpoint: string, args?: Record<string, any>) => {
      if (!['next', '/next'].includes(endpoint) || args?.protobuf || args?.override_endpoint) throw new Error('Unexpected comments request');
      const continuation = args?.continuation || args?.token;
      if (typeof continuation !== 'string' || !continuation || continuation.length > 50000) throw new Error('Invalid comments continuation');
      const raw = await send(continuation);
      return args?.parse ? Parser.parseResponse(raw) : { success: true, status_code: 200, data: raw };
    }) as typeof session.actions.execute;
    return api = new Innertube(session);
  }
  function hasReplies(entry: ThreadState) {
    if (entry.replies.size >= 100 || [...threads.values()].reduce((total, item) => total + item.replies.size, 0) >= 200) return false;
    return entry.cursor ? entry.cursor.has_continuation : entry.thread.has_replies;
  }
  function snapshot() {
    let remainingReplies = 200;
    state.items = [...threads].map(([key, entry]) => {
      const comment = entry.thread.comment;
      const replyCount = Number(comment?.reply_count?.replace(/,/g, ''));
      const replies = [...entry.replies.values()].slice(0, Math.min(100, remainingReplies));
      remainingReplies -= replies.length;
      return { key, author: String(comment?.author?.name || '').slice(0, 200),
        ...(comment?.author?.best_thumbnail?.url ? { avatar: comment.author.best_thumbnail.url.slice(0, 4096) } : {}),
        text: String(comment?.content?.toString() || '').slice(0, 4000),
        ...(Number.isSafeInteger(replyCount) && replyCount >= 0 ? { replyCount } : {}),
        hasReplies: remainingReplies > 0 && hasReplies(entry), repliesLabel: 'Load replies',
        replies };
    });
  }
  function collectReplies(entry: ThreadState, replies?: Iterable<YTNodes.CommentThread>) {
    let budget = 200 - entry.replies.size - [...threads.values()].reduce((total, item) => total + (item === entry ? 0 : item.replies.size), 0);
    for (const reply of replies || []) {
      const comment = reply.comment;
      if (budget <= 0 || entry.replies.size >= 100) break;
      if (comment?.comment_id && comment.content && !entry.replies.has(comment.comment_id)) {
        entry.replies.set(comment.comment_id, { key: comment.comment_id,
          ...(comment.author?.best_thumbnail?.url ? { avatar: comment.author.best_thumbnail.url.slice(0, 4096) } : {}),
          author: String(comment.author?.name || '').slice(0, 200), text: String(comment.content).slice(0, 2000) });
        budget--;
      }
    }
  }
  async function request(key?: string) {
    const captured = state, controller = new AbortController();
    pending = controller; captured.loading = true; captured.failed = false;
    // Let the synchronous bridge reply before publishing a loading update.
    void Promise.resolve().then(() => { if (captured === state && !destroyed) notify(); });
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      if (key) {
        const entry = threads.get(key);
        if (!entry || !hasReplies(entry)) return;
        const next = entry.cursor ? await entry.cursor.getContinuation() : await entry.thread.getReplies();
        if (captured !== state || captured.route !== route() || controller.signal.aborted || destroyed) return;
        entry.cursor = next; collectReplies(entry, next.replies);
      } else {
        const target = parseWatchLink(captured.route) || parseShortLink(captured.route);
        if (!target) return;
        const next = page ? await page.getContinuation() : await client().getComments(target.videoId);
        if (captured !== state || captured.route !== route() || controller.signal.aborted || destroyed) return;
        const before = threads.size;
        for (const thread of next.contents) {
          const comment = thread.comment;
          if (!comment?.comment_id || !comment.content || threads.has(comment.comment_id) || threads.size >= 100) continue;
          const entry: ThreadState = { thread, replies: new Map() };
          if (thread.replies) { entry.cursor = thread; collectReplies(entry, thread.replies); }
          threads.set(comment.comment_id, entry);
        }
        page = next; initialized = true;
        emptyPages = threads.size === before ? emptyPages + 1 : 0;
        captured.hasMore = next.has_continuation && threads.size < 100 && emptyPages < 2;
      }
      failedKey = undefined; snapshot();
    } catch {
      if (captured === state && captured.route === route() && !destroyed) { captured.failed = true; failedKey = key; }
    } finally {
      clearTimeout(timer);
      if (pending === controller) { pending = undefined; captured.loading = false; }
      if (captured === state && captured.route === route()) notify();
    }
  }
  function more(start = false) {
    syncRoute();
    if (destroyed || !(parseWatchLink(state.route) || parseShortLink(state.route))) return false;
    if (pending) return true;
    if (start && initialized && !state.failed) return true;
    if (!state.hasMore && !state.failed) return false;
    void request(state.failed ? failedKey : undefined); return true;
  }
  function replies(key: string) {
    syncRoute();
    if (destroyed || !threads.has(key)) return false;
    if (pending) return true;
    if (!hasReplies(threads.get(key)!)) return false;
    void request(key); return true;
  }
  return { read() { syncRoute(); return { ...state }; }, more, replies, routeChanged: syncRoute,
    destroy() { destroyed = true; pending?.abort(); pending = undefined; threads.clear(); api = undefined; page = undefined; } };
}
