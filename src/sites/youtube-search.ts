import { Parser } from 'youtubei.js/web';
import type { BrowseItem } from '../shared/browse-data';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { playlistColor } from '../shared/playlist-colors';

type Node = Record<string, any>;
type ParsedFeed = { items: BrowseItem[]; continuation?: string };
// Parser warnings can contain raw response data. Keep that data in MAIN.
Parser.setParserErrorHandler(() => {});

const cardRenderers = new Set(['videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer',
  'playlistVideoRenderer', 'movieRenderer', 'radioRenderer', 'playlistRenderer',
  'compactRadioRenderer', 'compactPlaylistRenderer', 'lockupViewModel', 'reelItemRenderer', 'shortsLockupViewModel']);

// Walk API containers once, in server order. Each card is parsed by YouTube.js;
// optional movie overlays are normalized before parsing, with no legacy parser.
export function parseYouTubeJsBrowse(raw: Node): ParsedFeed {
  const items = new Map<string, BrowseItem>();
  const visited = new Set<object>();
  let continuation: string | undefined;
  function visit(value: any, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || visited.size >= 30000 || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    if (value.slot === 'RELOAD_CONTINUATION_SLOT_HEADER') return;
    const key = Object.keys(value).find(key => cardRenderers.has(key));
    if (key) {
      const original = value[key];
      const data = key === 'movieRenderer' && original?.thumbnailOverlays == null
        ? { ...original, thumbnailOverlays: [] } : original;
      if (data?.isPlayable === false) return;
      let cards: BrowseItem[] = [];
      try { cards = searchItems([Parser.parseItem({ [key]: data })]); } catch { /* Skip malformed cards without losing adjacent results. */ }
      for (const card of cards) items.set(card.id, card);
      return;
    }
    const token = value.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || value.nextContinuationData?.continuation;
    if (typeof token === 'string') continuation = token;
    // Action menus, headers and ads are not feed contents.
    for (const [key, child] of Object.entries(value)) {
      if (/menu|header|adSlot|promoted|navigationEndpoint|commandMetadata/i.test(key)) continue;
      visit(child, depth + 1);
    }
  }
  visit(raw);
  return { items: [...items.values()], continuation };
}

// Adapt parsed nodes to the existing card contract, retaining search order.
export function searchItems(results: Iterable<unknown>): BrowseItem[] {
  const items = new Map<string, BrowseItem>();
  const visited = new Set<object>();
  const label = (value: any) => value == null ? '' : String(value).slice(0, 2000);
  function visit(value: any, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || visited.size >= 30000 || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (value.is_playable === false) return;
    const short = ['ReelItem', 'ShortsLockupView'].includes(value.type);
    const lockup = value.type === 'LockupView';
    const playlist = ['Playlist', 'CompactPlaylist', 'Mix', 'CompactMix'].includes(value.type) ||
      (lockup && value.content_type === 'PLAYLIST');
    const video = ['Video', 'GridVideo', 'CompactVideo', 'PlaylistVideo', 'Movie'].includes(value.type) ||
      (lockup && ['VIDEO', 'MOVIE', 'SHORT'].includes(value.content_type));
    if (short || video || playlist) {
      const endpoint = value.endpoint || value.on_tap_endpoint || value.renderer_context?.command_context?.on_tap;
      const payload = endpoint?.payload || {};
      const id = payload.videoId || value.video_id || (video || short ? value.content_id || value.id : undefined) ||
        value.first_videos?.[0]?.id;
      let target;
      try {
        const url = new URL(endpoint?.metadata?.url || (short ? `/shorts/${id || ''}` : '/watch'), 'https://www.youtube.com');
        if (id && !url.searchParams.has('v') && !short) url.searchParams.set('v', id);
        const playlistId = payload.playlistId || (playlist ? value.id || value.content_id : undefined);
        if (!url.searchParams.has('list') && playlistId) url.searchParams.set('list', playlistId);
        if (Number.isInteger(payload.index) && payload.index >= 0 && !url.searchParams.has('index'))
          url.searchParams.set('index', String(payload.index + 1));
        if (payload.startRadio === true) url.searchParams.set('start_radio', '1');
        if (typeof payload.params === 'string') url.searchParams.set('params', payload.params);
        target = short ? parseShortLink(url.href) : parseWatchLink(url.href);
      } catch { /* Ignore unsupported destinations. */ }
      const title = label(value.title || value.overlay_metadata?.primary_text || value.metadata?.title);
      if (target && title) {
        const fallback = `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`;
        const image = value.content_image;
        const thumbnails = value.thumbnails || value.thumbnail || image?.image || image?.primary_thumbnail?.image || [];
        let thumbnail = fallback;
        // YouTube.js sorts thumbnails by width; choose the largest image.
        const candidate = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
        try { const url = new URL(candidate); if (url.protocol === 'https:') thumbnail = url.href; } catch { /* Use fallback. */ }
        items.set(target.id, { id: target.id, href: target.href, title, thumbnail, thumbnailFallback: fallback,
          channel: label(value.author?.name === 'N/A' ? '' : value.author?.name || value.author ||
            value.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text),
          ...(playlist ? { isPlaylist: true, stackColorLight: playlistColor(image?.stack_color?.light_theme),
            stackColorDark: playlistColor(image?.stack_color?.dark_theme) } : {}) });
      }
      return;
    }
    // Visit content containers only; menu/watch-card links are not results.
    for (const key of ['contents', 'items', 'content', 'videos', 'tabs']) visit(value[key], depth + 1);
  }
  for (const result of results) visit(result);
  return [...items.values()];
}
