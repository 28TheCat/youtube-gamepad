import type { Action, Disposition, NavigationPolicy, NavigationSection, Scope } from './ports';

export type InteractiveElement = HTMLElement & { disabled?: boolean };
export type NavigationRoot = Document | HTMLElement;
export interface BrowseState { category?: string; categoryScroll?: number; sidebarScroll?: number; gridScroll?: number }
export interface BrowseRestore { clicked?: boolean; category?: string; activated?: boolean; previousFeed?: string }
export interface NavigationConfig extends Partial<NavigationPolicy> {
  overlays?: string;
  beforeActivate?(el: HTMLElement): boolean | void;
  selectors?: string; overlayItems?: string; defaultSection?: string;
  sections?: Record<string, NavigationSection>;
  getScope?(): NavigationRoot;
  getSection?(el: HTMLElement | null | undefined): string;
  getKey?(el: HTMLElement | null | undefined): string | Element | undefined;
  getContainer?(el: HTMLElement | null | undefined): HTMLElement | null | undefined;
  getSelectionTarget?(el: HTMLElement): HTMLElement;
  getSelectionRadius?(el: HTMLElement): string;
  ownsSelectionPaint?(el: HTMLElement): boolean;
  getRow?(el: HTMLElement): string | Element | null;
  getOverlayView?(root: NavigationRoot): string | null | undefined;
  getViewport?(): { top: number; bottom: number };
  filterCandidates?(list: InteractiveElement[]): InteractiveElement[];
  captureBrowseState?(): BrowseState | null;
  restoreBrowseState?(saved: BrowseState | null | undefined, progress: BrowseRestore): boolean;
  rememberRegionReturn?(): boolean;
  onSelectionChange?(el: HTMLElement | null, root: NavigationRoot): void;
  ignoreMutation?(record: MutationRecord): boolean;
  adjustSlider?(el: HTMLElement | null, delta: number): void;
  isSlider?(el: HTMLElement | null): boolean;
  onAction?(action: Action, context: import('./ports').ActionContext): Disposition | void;
}
export interface NavigationMemory { key?: string | Element; occurrence: number; section?: string; x: number; y: number; keys: (string | Element | undefined)[]; browse?: BrowseState | null }
export interface OverlayView { key: string; itemKey?: string | Element; index?: number }
export interface NavigationReads {
  scope?: NavigationRoot | null;
  rects: WeakMap<HTMLElement, DOMRect>;
  styles: WeakMap<HTMLElement, CSSStyleDeclaration>;
  candidates: Map<NavigationRoot, InteractiveElement[]>;
}
export interface RowMemory { column: number | null }
export interface YouTubeVideoDetails { videoId?: string; isLive?: boolean; title?: string; author?: string; shortDescription?: string; channelId?: string; viewCount?: string }
export interface YouTubePlayer extends HTMLElement {
  showControls?(): void; hideControls?(): void;
  getPlayerResponse?(): { videoDetails?: YouTubeVideoDetails };
  getOption?(module: string, option: string): unknown;
  setOption?(module: string, option: string, value: unknown): void;
  loadModule?(module: string): void;
  unloadModule?(module: string): void;
  isSubtitlesOn?(): boolean;
  toggleSubtitles?(): void;
}
export interface RuntimeScope extends Scope {}
export type DisposerHost = Window & { [key: symbol]: (() => void) | undefined };
