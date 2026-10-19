/** Serializable list data shared by InnerTube, the bridge and the browse UI. */
export interface BrowseItem {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
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
