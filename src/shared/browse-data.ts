/** Serializable list data shared by InnerTube, the bridge and the browse UI. */
export interface BrowseItem {
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
  readonly isPlaylist?: boolean;
  readonly stackColorLight?: string;
  readonly stackColorDark?: string;
  readonly href: string;
}

export interface BrowseSnapshot {
  readonly route: string;
  readonly items: readonly BrowseItem[];
  readonly canLoadMore: boolean;
}
