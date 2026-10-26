import { contentRoots, continuationToken, parseYouTubePage, parsedChips, walkParsed, type ParsedPage } from './youtube-parser';
import type { BrowseItem } from '../shared/browse-data';
import { parseWatchLink, parseShortLink } from '../shared/watch-link';
import { playlistColor } from '../shared/playlist-colors';

type Node = Record<string, any>;
export function browsePage(page: ParsedPage) {
  const roots = contentRoots(page);
  return { items: searchItems(roots), continuation: continuationToken(roots), chips: parsedChips(page) };
}

export function parseYouTubeJsBrowse(raw: Node) {
  return browsePage(parseYouTubePage(raw));
}

// Adapt parsed nodes to the existing card contract, retaining search order.
export function parsedCards(roots: unknown): any[] {
  const cards: any[] = [];
  walkParsed(roots, node => {
    if (['Video', 'GridVideo', 'CompactVideo', 'PlaylistVideo', 'PlaylistPanelVideo', 'Movie',
      'Playlist', 'CompactPlaylist', 'Mix', 'CompactMix', 'LockupView', 'ReelItem', 'ShortsLockupView'].includes(node.type)) {
      cards.push(node); return false;
    }
  });
  return cards;
}

export function searchItems(results: Iterable<unknown>): BrowseItem[] {
  const items = new Map<string, BrowseItem>();
  for (const node of parsedCards([...results])) {
    const item = browseItem(node);
    if (item) items.set(item.id, item);
  }
  return [...items.values()];
}

export function browseItem(value: any, queuePlaylistId?: string): BrowseItem | undefined {
  const label = (value: any) => {
    const result = value == null ? '' : String(value);
    return ['N/A', '[object Object]'].includes(result) ? '' : result.slice(0, 2000);
  };
  if (value.is_playable === false) return;
  const short = ['ReelItem', 'ShortsLockupView'].includes(value.type);
  const lockup = value.type === 'LockupView';
  const playlist = ['Playlist', 'CompactPlaylist', 'Mix', 'CompactMix'].includes(value.type) ||
    (lockup && value.content_type === 'PLAYLIST');
  const video = ['Video', 'GridVideo', 'CompactVideo', 'PlaylistVideo', 'PlaylistPanelVideo', 'Movie'].includes(value.type) ||
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
      const playlistId = payload.playlistId || queuePlaylistId || (playlist ? value.id || value.content_id : undefined);
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
      const rows = value.metadata?.metadata?.metadata_rows || [];
      // Channel feeds omit the byline row. Statistics remain in the final
      // text row, whether or not a channel name precedes them.
      const textRows = rows.map((row: any) => (row.metadata_parts || []).map((part: any) => label(part.text)).filter(Boolean))
        .filter((parts: string[]) => parts.length);
      const details = playlist ? [] : textRows.at(-1) || [];
      const viewCount = textRows.length > 1 || details.length > 1 ? details[0] : undefined;
      const publishedTime = details.slice(1).join(' · ');
      const duration = label(
        image?.overlays?.flatMap((overlay: any) => overlay.badges || [])
          .find((badge: any) => /^(?:\d+:){1,2}\d{2}$/.test(label(badge.text)))?.text);
      const avatars = [...(value.metadata?.image?.avatar?.image || []), ...(value.author?.thumbnails || [])];
      const overlays = [...(value.thumbnail_overlays || []), ...(image?.overlays || []), ...(image?.primary_thumbnail?.overlays || [])];
      const progress = overlays.find((overlay: any) => overlay.type === 'ThumbnailOverlayResumePlayback')?.percent_duration_watched ??
        overlays.find((overlay: any) => overlay.progress_bar)?.progress_bar?.start_percent;
      const watchedPercent = !playlist && typeof progress === 'number' && Number.isFinite(progress)
        ? Math.max(0, Math.min(100, progress)) : 0;
      let channelAvatar: string | undefined;
      for (const avatar of avatars) {
        try {
          const url = new URL(avatar.url);
          if (url.protocol === 'https:') { channelAvatar = url.href; break; }
        } catch { /* Try the next channel image. */ }
      }
      return { id: target.id, href: target.href, title, thumbnail, thumbnailFallback: fallback,
        channel: label(value.author?.name) || label(value.short_byline_text) || label(value.author) ||
          (playlist || textRows.length > 1 || details.length === 1 ? textRows[0]?.[0] || '' : ''),
        ...(channelAvatar ? { channelAvatar } : {}), ...(viewCount ? { viewCount } : {}),
        ...(publishedTime ? { publishedTime } : {}), ...(duration ? { duration } : {}),
        ...(watchedPercent > 0 ? { watchedPercent } : {}),
        ...(playlist ? { isPlaylist: true, stackColorLight: playlistColor(image?.stack_color?.light_theme),
          stackColorDark: playlistColor(image?.stack_color?.dark_theme) } : {}) };
    }
    return;
  }
}
