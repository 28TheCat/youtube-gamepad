import { YTNodes } from 'youtubei.js/web';

type Node = Record<string, any>;
const text = (value: any): string => {
  const result = typeof value === 'string' ? value : value?.toString?.();
  return typeof result === 'string' && result !== 'N/A' && result !== '[object Object]' ? result.slice(0, 2000) : '';
};

// Presentation data only. Route identity, playlist positions, selection and
// continuation ownership stay in youtube-next.ts, including per-card fallback.
export function parseYouTubeJsNextCard(node: Node, queue: boolean) {
  try {
    let parsed: any;
    const data = queue ? node.playlistPanelVideoRenderer : node.compactVideoRenderer || node.videoRenderer;
    if (data) {
      // Do not parse unrelated action menus or service commands on a card.
      const fields = Object.fromEntries(Object.entries({ videoId: data.videoId, title: data.title, thumbnail: data.thumbnail,
        lengthText: data.lengthText, viewCountText: data.viewCountText,
        shortBylineText: data.shortBylineText || data.ownerText,
        longBylineText: data.longBylineText || data.shortBylineText || data.ownerText,
        ownerText: data.ownerText || data.shortBylineText,
        thumbnailOverlays: data.thumbnailOverlays }).filter(([, value]) => value !== undefined));
      parsed = queue ? new YTNodes.PlaylistPanelVideo(fields) : node.compactVideoRenderer
        ? new YTNodes.CompactVideo(fields) : new YTNodes.Video(fields);
    } else if (!queue && node.lockupViewModel) {
      parsed = new YTNodes.LockupView(node.lockupViewModel);
    } else {
      return;
    }
    const title = text(parsed.title || parsed.metadata?.title);
    if (!title) return;
    const image = parsed.content_image;
    const thumbnails = parsed.thumbnails || parsed.thumbnail || image?.image || image?.primary_thumbnail?.image || [];
    let thumbnail: string | undefined;
    // Thumbnail.fromResponse already orders these images by descending width.
    for (const candidate of thumbnails) {
      try { const url = new URL(candidate.url); if (url.protocol === 'https:') { thumbnail = url.href; break; } } catch { /* Try the next image. */ }
    }
    return { title, thumbnail,
      channel: text(parsed.author?.name || parsed.author || parsed.short_byline_text ||
        parsed.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text),
      duration: text(parsed.duration?.text), metadata: text(parsed.view_count) };
  } catch {
    // Unsupported or malformed nodes retain the existing bounded parser result.
    return;
  }
}
