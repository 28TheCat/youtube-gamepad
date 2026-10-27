import { PAGE_REQUEST, PAGE_RESPONSE, parsePageMessage, videoDetails, watchNextSnapshot, commentsSnapshot, watchInfoSnapshot, savedPlaylists, accountSnapshot, shortsSettingsSnapshot } from './page-protocol';
import type { PageAccess, PageOperation } from './page-protocol';
import { sidebarSnapshot } from '../shared/sidebar-data';

// DOM events cross Chrome worlds synchronously. JSON strings avoid sharing
// objects/functions and preserve the existing synchronous site port contract.
// This bridge never accepts extension API requests from the page.
export function createPageClient(): PageAccess {
  let sequence = 0;
  const session = crypto.randomUUID();
  let requesting = false;
  let available = false;
  let disposed = false;
  const cancellations = new Set<() => void>();
  function request(operation: PageOperation, fields: object = {}) {
    if (requesting || disposed) return;
    const id = `${session}:${++sequence}`;
    let response: Record<string, unknown> | undefined;
    const receive = (event: Event) => {
      const value = parsePageMessage((event as CustomEvent).detail);
      if (value?.id === id && value.operation === operation) response = value;
    };
    document.addEventListener(PAGE_RESPONSE, receive);
    requesting = true;
    try {
      document.dispatchEvent(new CustomEvent(PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id, operation, ...fields }) }));
    } finally {
      requesting = false;
      document.removeEventListener(PAGE_RESPONSE, receive);
    }
    available = response?.ok === true;
    return available ? response?.value : undefined;
  }
  function asyncRequest(operation: PageOperation, fields: object = {}): Promise<unknown> {
    if (disposed) return Promise.resolve(undefined);
    const id = `${session}:${++sequence}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(undefined), 45000);
      const cancel = () => finish(undefined);
      function finish(value: unknown) { clearTimeout(timer); cancellations.delete(cancel); document.removeEventListener(PAGE_RESPONSE, receive); resolve(value); }
      function receive(event: Event) {
        const value = parsePageMessage((event as CustomEvent).detail);
        if (value?.id === id && value.operation === operation) finish(value.ok ? value.value : undefined);
      }
      document.addEventListener(PAGE_RESPONSE, receive);
      cancellations.add(cancel);
      document.dispatchEvent(new CustomEvent(PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id, operation, ...fields }) }));
    });
  }
  return {
    shortsRecommendations: async (videoId, reset) => {
      const raw = await asyncRequest('shortsRecommendations', { videoId, refresh: reset === true }) as { ids?: unknown; hasMore?: unknown } | undefined;
      if (!raw || !Array.isArray(raw.ids)) return undefined;
      return { ids: [...new Set(raw.ids.slice(0, 100).filter((id): id is string => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))], hasMore: raw.hasMore === true };
    },
    playShorts: videoId => request('playShorts', { videoId }) === true,
    readShortsSettings: () => shortsSettingsSnapshot(request('readShortsSettings')),
    shortsSetting: (videoId, action, quality) => request('shortsSetting', { videoId, action, quality }) === true,
    readSidebar: async () => sidebarSnapshot(await asyncRequest('readSidebar')),
    readAccount: async refresh => accountSnapshot(await asyncRequest('readAccount', { refresh: refresh === true })),
    destroy() { disposed = true; available = false; for (const cancel of [...cancellations]) cancel(); },
    get available() { return available; },
    ping: () => request('ping') === true,
    readPlayerVideoId: () => {
      const id = request('readPlayerVideoId');
      return typeof id === 'string' && /^[\w-]{1,200}$/.test(id) ? id : undefined;
    },
    readVideoDetails: () => videoDetails(request('readVideoDetails')),
    readWatchInfo: () => watchInfoSnapshot(request('readWatchInfo')),
    watchAction: async action => await asyncRequest('watchAction', { action }) === true,
    watchPlaylists: async () => savedPlaylists(await asyncRequest('watchPlaylists')),
    watchPlaylistToggle: async key => await asyncRequest('watchPlaylistToggle', { key }) === true,
    readWatchNext: () => watchNextSnapshot(request('readWatchNext')),
    moreWatchNext: () => request('moreWatchNext') === true,
    readComments: () => commentsSnapshot(request('readComments')),
    moreComments: start => request('moreComments', { start: start === true }) === true,
    commentReplies: key => request('commentReplies', { key }) === true,
    commentTranslate: (key, language) => request('commentTranslate', { key, language }) === true,
    commentPost: async (text, key) => await asyncRequest('commentPost', { text, key }) === true,
    commentSort: sort => request('commentSort', { sort }) === true,
    openWatchVideo: href => request('openBrowseVideo', { href }) === true,
    openBrowseRoute: href => request('openBrowseRoute', { href }) === true,
    showControls: () => { request('showControls'); },
    hideControls: () => { request('hideControls'); }
  };
}
