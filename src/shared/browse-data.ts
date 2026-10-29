/** Serializable list data shared by InnerTube, the bridge and the browse UI. */
export interface BrowseItem {
  readonly filterData?: import('./home-filter').HomeFilterData;
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly channelAvatar?: string;
  readonly channelBadge?: 'verified' | 'artist';
  readonly viewCount?: string;
  readonly publishedTime?: string;
  readonly duration?: string;
  readonly watchedPercent?: number;
  readonly thumbnail: string;
  readonly thumbnailFallback?: string;
  readonly previewThumbnail?: string;
  readonly isPlaylist?: boolean;
  readonly stackColorLight?: string;
  readonly stackColorDark?: string;
  readonly href: string;
}

/** Keep signed YouTube preview URLs intact across the page boundary. */
export function safePreviewThumbnail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && /^(?:i|i\d)\.ytimg\.com$/.test(url.hostname)) return url.href;
  } catch { /* Cards without a usable preview retain their cover. */ }
}

export interface ChannelHeader {
  title: string; avatar: string; banner: string; metadata: string; description: string;
}

export interface BrowseSnapshot {
  readonly channelHeader?: ChannelHeader;
  readonly route: string;
  readonly items: readonly BrowseItem[];
  readonly canLoadMore: boolean;
  readonly autoLoadBlocked?: boolean;
  readonly filteredCount?: number;
}
