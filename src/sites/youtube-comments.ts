import { createYouTubeHeaders, requestYouTube, mutateYouTube } from './youtube-request';
import { Innertube, Parser } from 'youtubei.js/web';
import { createYouTubeSession } from './youtube-session';
import type { YT, YTNodes } from 'youtubei.js/web';
import type { CommentSnapshot, CommentReplySnapshot, CommentsStatus } from '../../types/ports';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { PAGE_COMMENTS } from '../bridge/page-protocol';
import { commentLanguage } from '../shared/comment-language';
import { nativeCommentTranslations, type NativeCommentTranslation } from './native-comment-translation';

export interface CommentsSnapshot extends CommentsStatus {
  route: string; items: CommentSnapshot[];
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
  let sort: 'TOP_COMMENTS' | 'NEWEST_FIRST' = 'TOP_COMMENTS', posting = false;
  let writeController: AbortController | undefined;
  const signedIn = () => (window as any).ytcfg?.get?.('LOGGED_IN') === true;
  const threads = new Map<string, ThreadState>();
  const translations = new Map<string, NonNullable<CommentReplySnapshot['translation']>>();
  const translationJobs = new Map<string, AbortController>();
  const nativeTranslations = new Map<string, NativeCommentTranslation>();
  const route = () => location.pathname + location.search;
  function notify() { if (!destroyed) document.dispatchEvent(new Event(PAGE_COMMENTS)); }
  function syncRoute() {
    if (state.route === route()) return;
    pending?.abort(); pending = undefined; page = undefined; api = undefined;
    initialized = false; failedKey = undefined; emptyPages = 0; threads.clear();
    writeController?.abort(); writeController = undefined; posting = false; sort = 'TOP_COMMENTS';
    for (const job of translationJobs.values()) job.abort();
    translationJobs.clear(); translations.clear();
    nativeTranslations.clear();
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
    for (const [key, entry] of nativeCommentTranslations(raw)) {
      if (entry) nativeTranslations.set(key, entry);
      else nativeTranslations.delete(key);
    }
    return raw;
  }
  function client() {
    if (api) return api;
    const context = (window as any).ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context?.client) throw new Error('YouTube context unavailable');
    const session = createYouTubeSession(context, async () => {
      throw new Error('Unexpected network request from comments parser');
    });
    // Keep the library's comment/reply cursors and initial token generation,
    // but connect their actions directly to our JSON transport. No synthetic
    // fetch, request-body round trip or Response serialization is needed.
    session.actions.execute = (async (endpoint: string, args?: Record<string, any>) => {
      const path = endpoint.replace(/^\//, '');
      if (args?.protobuf || args?.override_endpoint) throw new Error('Unexpected comments request');
      if (['comment/create_comment', 'comment/create_comment_reply'].includes(path)) {
        if (!posting || !writeController || !signedIn()) throw new Error('Comment submission unavailable');
        const controller = writeController, captured = state;
        const context = (window as any).ytcfg?.get?.('INNERTUBE_CONTEXT');
        const { parse: _parse, ...payload } = args || {};
        const headers = await createYouTubeHeaders(context);
        if (destroyed || captured !== state || captured.route !== route() || controller.signal.aborted) throw new Error('Comment submission cancelled');
        const raw = await mutateYouTube(path, { method: 'POST', credentials: 'same-origin', headers,
          body: JSON.stringify({ ...payload, context }), signal: controller.signal });
        return { success: true, status_code: 200, data: raw };
      }
      if (path !== 'next') throw new Error('Unexpected comments request');
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
  function canReply(entry: ThreadState) {
    const dialog = entry.thread.comment?.reply_command?.dialog as YTNodes.CommentReplyDialog | undefined;
    return signedIn() && !!dialog?.reply_button?.endpoint;
  }
  function snapshot() {
    let remainingReplies = 200;
    state.items = [...threads].map(([key, entry]) => {
      const comment = entry.thread.comment;
      const replyCount = Number(comment?.reply_count?.replace(/,/g, ''));
      const replies = [...entry.replies.values()].slice(0, Math.min(100, remainingReplies))
        .map(reply => ({ ...reply, ...(nativeTranslations.has(reply.key) ? { translationTarget: nativeTranslations.get(reply.key)!.language } : {}),
          ...(translations.has(reply.key) ? { translation: translations.get(reply.key) } : {}) }));
      remainingReplies -= replies.length;
      return { key, ...(canReply(entry) ? { canReply: true } : {}), author: String(comment?.author?.name || '').slice(0, 200),
        ...(nativeTranslations.has(key) ? { translationTarget: nativeTranslations.get(key)!.language } : {}),
        ...(translations.has(key) ? { translation: translations.get(key) } : {}),
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
        const next = page ? await page.getContinuation() : await client().getComments(target.videoId, sort);
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
  function interaction() {
    return { signedIn: signedIn(), canPost: signedIn() && !!(page?.header?.create_renderer as any)?.submit_button?.endpoint,
      sort, sortAvailable: initialized, posting };
  }
  function changeSort(value: 'TOP_COMMENTS' | 'NEWEST_FIRST') {
    syncRoute();
    if (destroyed || posting || pending || !initialized || !['TOP_COMMENTS', 'NEWEST_FIRST'].includes(value)) return false;
    if (sort === value) return true;
    sort = value; page = undefined; initialized = false; failedKey = undefined; emptyPages = 0;
    threads.clear(); state.items = []; state.hasMore = true;
    void request(); return true;
  }
  async function post(text: string, key?: string) {
    syncRoute();
    if (destroyed || posting || pending || !signedIn() || typeof text !== 'string' || !text.trim() || text.length > 4000) return false;
    const entry = key ? threads.get(key) : undefined;
    if (key ? !entry || !canReply(entry) : !interaction().canPost) return false;
    const captured = state, controller = new AbortController();
    posting = true; writeController = controller; notify();
    try {
      const result = key ? await entry!.thread.comment!.reply(text.trim()) : await page!.createComment(text.trim());
      if (destroyed || captured !== state || captured.route !== route() || controller.signal.aborted || !result.success) return false;
      // Refresh through the server rather than inventing an author or comment ID.
      page = undefined; initialized = false; threads.clear(); state.items = []; state.hasMore = true;
      void request(); return true;
    } catch { return false; }
    finally { if (writeController === controller) { writeController = undefined; posting = false; notify(); } }
  }
  function translate(key: string, language: string) {
    syncRoute();
    const target = commentLanguage(language);
    const native = nativeTranslations.get(key);
    if (destroyed || !target || !native || native.language !== target) return false;
    const item = state.items.find(item => item.key === key) || state.items.flatMap(item => item.replies).find(item => item.key === key);
    if (!item) return false;
    const cached = translations.get(key);
    if (cached?.language === target && (cached.loading || cached.text)) return true;
    translationJobs.get(key)?.abort();
    const controller = new AbortController(), captured = state;
    translationJobs.set(key, controller);
    translations.set(key, { language: target, loading: true, failed: false }); snapshot();
    void Promise.resolve().then(() => { if (captured === state && !destroyed) notify(); });
    void (async () => {
      try {
        const context = (window as any).ytcfg?.get?.('INNERTUBE_CONTEXT');
        if (!context?.client) throw new Error('YouTube context unavailable');
        const headers = await createYouTubeHeaders(context);
        const raw = await requestYouTube('comment/perform_comment_action', { method: 'POST', credentials: 'same-origin', headers,
          body: JSON.stringify({ context, actions: [native.action] }), signal: controller.signal });
        const mutations = raw.frameworkUpdates?.entityBatchUpdate?.mutations;
        const translated = mutations?.find((mutation: any) => typeof mutation?.payload?.commentEntityPayload?.translatedContent?.content === 'string')
          ?.payload.commentEntityPayload.translatedContent.content;
        if (typeof translated !== 'string' || !translated.trim()) throw new Error('Translation unavailable');
        if (captured === state && captured.route === route() && !controller.signal.aborted && !destroyed)
          translations.set(key, { language: target, text: translated.slice(0, 8000), loading: false, failed: false });
      } catch {
        if (captured === state && !controller.signal.aborted && !destroyed)
          translations.set(key, { language: target, loading: false, failed: true });
      } finally {
        if (translationJobs.get(key) === controller) translationJobs.delete(key);
        if (captured === state && captured.route === route() && !controller.signal.aborted && !destroyed) { snapshot(); notify(); }
      }
    })();
    return true;
  }
  return { read() { syncRoute(); return { ...state, interaction: interaction() }; }, more, replies, translate, post, changeSort, routeChanged: syncRoute,
    destroy() { destroyed = true; pending?.abort(); writeController?.abort(); pending = undefined; for (const job of translationJobs.values()) job.abort();
      translationJobs.clear(); translations.clear(); nativeTranslations.clear(); threads.clear(); api = undefined; page = undefined; } };
}
