/** Development-only contracts. No imports, build step or runtime code are added
 * to the manifest scripts. Snapshots contain data; DOM handles stay in ports. */
export type Mode = 'browse' | 'playback' | 'controls';
export type Disposition = 'handled' | 'blocked' | 'pass';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Action = Direction | 'confirm' | 'back' | 'help' | 'search' | 'playPause'
  | 'goLive' | 'pause' | 'mute' | 'captions' | 'volumeDown' | 'volumeUp' | 'seekBack' | 'seekForward'
  | 'keyboardSymbols' | 'keyboardCandidates';
export type WatchAction = 'subscribe' | 'like' | 'dislike' | 'save';
export type Capability = 'available' | 'missing' | 'failed';
export interface RouteSnapshot { readonly key: string; readonly isWatch: boolean }
export interface TimelineSnapshot {
  readonly isLive: boolean; readonly canSeek: boolean; readonly atLiveEdge: boolean;
  readonly start: number; readonly end: number;
  readonly ranges: readonly { start: number; end: number }[];
}
export interface VideoSnapshot {
  readonly timeline: TimelineSnapshot;
  readonly currentTime: number; readonly duration: number;
  readonly paused: boolean; readonly ended: boolean;
  readonly volume?: number; readonly muted?: boolean;
}
export interface PlaybackSnapshot {
  readonly video: VideoSnapshot | null;
  readonly captionsEnabled: boolean; readonly settingsOpen: boolean;
}
export interface RecommendationSnapshot {
  readonly metadata?: string; readonly duration?: string;
  readonly key: string; readonly label: string; readonly channel: string;
  readonly thumbnail: string; readonly thumbnailFallback: string;
}
export interface WatchPageSnapshot extends RouteSnapshot {
  readonly title: string; readonly channel: string; readonly description: string;
  readonly recommendations: readonly RecommendationSnapshot[];
  // Optional because the existing degraded read returns a minimal page snapshot.
  readonly waiting?: boolean; readonly avatar?: string; readonly subscribed?: boolean;
  readonly liked?: boolean; readonly disliked?: boolean; readonly viewCount?: string | number | null;
}
export interface CommentSnapshot {
  readonly key: string; readonly author: string; readonly text: string;
  readonly hasReplies: boolean; readonly repliesLabel: string; readonly expanded: readonly string[];
}
export interface BrowseAccountSnapshot { readonly label: string }
export type WatchFeatures = Readonly<Partial<Record<'metadata' | 'recommendations' | 'comments'
  | 'channel' | 'captions' | 'settings' | 'subscribe' | 'like' | 'dislike' | 'save' | 'nativeLayers', Capability>>>;
export interface AdaptationSnapshot { readonly status: 'inactive' | 'waiting' | 'ready' | 'fallback'; readonly reason: string; readonly route?: string }
export interface CoordinatorSnapshot { readonly mode: Mode; readonly enabled: boolean; readonly surfaceReady: boolean; readonly navigating: boolean }
  export interface Settings { enabled: boolean; theater: boolean; deadzone: number; repeatDelay: number; repeatInterval: number; bindings?: Record<string, number>; bindingLayouts?: Record<string, Record<string, number>> }
export type SearchTarget = HTMLInputElement | null;
export type OperationResult = boolean | void;
export type RecommendationResult = 'opened' | 'blocked' | 'missing';
export interface WatchDataPort {
  readRoute(): RouteSnapshot;
  readWatchPage(): WatchPageSnapshot;
  readPlayback(): PlaybackSnapshot;
  readComments(): readonly CommentSnapshot[];
  readWatchFeatures?(): WatchFeatures;
}
export interface WatchRequest {
  (type: 'moreRecommendations'): OperationResult;
  (type: 'mode', value: Mode): OperationResult;
  (type: 'media', value: Action): OperationResult | Promise<OperationResult>;
  (type: 'watchAction', value: WatchAction): OperationResult | Promise<OperationResult>;
  (type: 'seek', value: number): OperationResult;
  (type: 'recommendation', value: string): RecommendationResult | false;
  (type: 'replies', value: string): OperationResult;
  (type: 'comments', value?: boolean): OperationResult;
  (type: 'settings' | 'backSettings' | 'channel'): OperationResult;
}
export interface WatchPort extends WatchDataPort {
  readonly state: CoordinatorSnapshot; readonly navigating: boolean;
  request: WatchRequest;
  observePlayback(playback: PlaybackSnapshot): void;
  hasTemporaryLayer(): boolean; hasNativeLayer(): boolean;
  requestAutoHide(idle: number): void;
  dispatchAction(action: Action): Disposition;
}
export interface SearchDataPort {
  getSearchTarget(): SearchTarget;
  readSearch(target?: SearchTarget): string;
  syncSearch(target: SearchTarget, value: string, cursor: [number, number]): void;
  moveSearchCursor(target: SearchTarget, cursor: [number, number]): void;
  submitSearch(target: SearchTarget, value: string, beforeSubmit: () => void): boolean;
  readTheme(): boolean;
}
export interface MenuPort extends SearchDataPort {
  interactionChanged(): void;
  perform(action: Action): OperationResult | Promise<OperationResult>;
  dispatchAction(action: Action): Disposition;
}
export interface NavigationSnapshot {
  readonly target?: string | null; readonly pushed?: number; readonly traversal?: boolean;
}
export interface AppSnapshot {
  readonly mode: Mode; readonly enabled: boolean; readonly route: string; readonly settledRoute: string;
  readonly returnRoute: string | null; readonly openingVideo: boolean; readonly watchDepth: number;
  readonly navigation: NavigationSnapshot | null; readonly returning: boolean; readonly chainVerified: boolean;
  readonly adaptation?: AdaptationSnapshot;
}
export interface WatchSnapshot {
  readonly row: 'controls' | 'progress' | 'recommendations'; readonly index: number;
  readonly controlIndex: number; readonly recommendationIndex: number; readonly adjusting: boolean;
  readonly panel: '' | 'description' | 'comments'; readonly panelIndex: number; readonly playIndex: number;
}
export interface MenuSnapshot {
  readonly opened: boolean; readonly view: 'main' | 'search'; readonly openedFrom: 'quickMenu' | 'pageSearch' | null;
  readonly menuSelection: number; readonly choosingLanguage: boolean; readonly composing: string;
  readonly candidatePage: number; readonly uppercase: boolean;
  readonly frame: 'LETTER_LAYOUT' | 'NUMBER_LAYOUT'; readonly language: 'en' | 'zh-CN';
}
export interface InteractionSnapshot { readonly app: AppSnapshot; readonly watch: WatchSnapshot; readonly menu: MenuSnapshot }
export interface Effect { readonly type: string; readonly value?: string | number | boolean }
export interface TransitionResult { readonly nextState: InteractionSnapshot; readonly effects: readonly Effect[]; readonly disposition: Disposition }
/** Payloads are progressively narrowed as individual state rules gain checking. */
export interface InteractionEvent { type: string; [key: string]: unknown }
export interface InteractionStore { readonly state: InteractionSnapshot; dispatch(event: InteractionEvent): TransitionResult }
export type Dispose = () => void;
export interface Scope {
  readonly destroyed: boolean; readonly size: number;
  cleanup(dispose: Dispose): Dispose;
  listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): Dispose;
  timeout(callback: () => void, delay: number): number | undefined;
  clearTimeout(id: number | undefined): void;
  interval(callback: () => void, delay: number): number | undefined;
  frame(callback: FrameRequestCallback): number | undefined;
  observer(callback: MutationCallback): MutationObserver;
  destroy(): void;
}
export interface Runtime { scope(name: string): Scope; destroy(): void; readonly resources: Readonly<Record<string, number>> }
export interface ControllerStyle {
  readonly family: 'xbox' | 'playstation' | 'switch' | 'generic';
  use(pad: Gamepad | undefined): void;
  readonly css: string;
  register(root: ShadowRoot | Document): Dispose;
  hint<T extends HTMLElement>(node: T, text: string): T;
  bind<T extends HTMLElement>(node: T, text: string, attribute?: string): T;
  badge<T extends HTMLElement>(node: T, key: string): T;
  configureBindings?(raw?: Record<string, number>): void;
  identify(id?: string): ControllerStyle['family']; format(text: string): string;
}
export interface FocusTarget {
  region: string; itemKey?: string | Element; index?: number; scope?: Document | Element; el?: HTMLElement;
}
export interface FocusRecord extends FocusTarget { owner: string; routeKey: string; keys: readonly (string | Element)[] }
export interface FocusOwner {
  active(): boolean; capture(): FocusTarget | null | undefined;
  items(region: string, target: FocusTarget): readonly FocusTarget[];
  fallback(target?: FocusTarget | null): FocusTarget;
  apply(target: FocusTarget): void;
}
export interface FocusManager {
  readonly suspended: boolean; register(owner: string, adapter: FocusOwner): Dispose;
  capture(preferred?: string): FocusRecord | null;
  restore(target: FocusRecord | null): void;
  open(token: Element, preferred?: string, priority?: number): void;
  close(token: Element, apply?: boolean): void;
  isSuspendedScope(scope: Element): boolean;
}
export interface DiagnosticState { route?: string; mode?: Mode; adaptation?: string; enabled?: boolean; surfaceReady?: boolean; navigating?: boolean }
export interface Diagnostics { record(module: string, operation: string, error: unknown, state?: DiagnosticState): void }
export interface InputDependencies { runtime: Runtime; controllerStyle: ControllerStyle; isSearchOpen(): boolean }
export interface SiteDependencies { runtime: Runtime; diagnostics?: Diagnostics; focusManager?: FocusManager }
export interface InputModule { readonly connected: boolean; readonly mode: 'mouse' | 'gamepad'; configure(values: Partial<Settings>): void; destroy(): void }
export interface MenuModule { readonly opened: boolean; readonly state: MenuSnapshot; connect(port: MenuPort): void; close(): void; openSearch(target?: SearchTarget): void; handle(action: Action): Disposition; destroy(): void }
export interface WatchModule {
  readonly ownsFocus: boolean;
  readonly state: Pick<WatchSnapshot, 'row' | 'index' | 'adjusting' | 'panel'> & { readonly mode: Mode; readonly recommendations: number };
  connect(port: WatchPort): void; sync(mode?: Mode, preferences?: Partial<Settings>): void;
  show(target?: 'controls' | 'recommendations'): void; handle(action: Action): boolean;
  handleInput(action: Action): Disposition; refresh(): void; destroy(): void;
  mediaFeedback(action: Action): void;
}
export interface ActionContext { current?: HTMLElement | null; scope: Document | Element }
export interface NavigationPolicy {
  perform(action: Action): OperationResult | Promise<OperationResult>;
  shouldShowSelection(context: ActionContext): boolean;
  interceptAction(action: Action, context?: Partial<ActionContext>): boolean;
  handleRegion(action: Action, context: ActionContext): Disposition;
  handleBase(action: Action, context: ActionContext): Disposition;
  onScopeChange(): void; isNavigating(): boolean; getInputLayer(): string | null;
  handleLayer(action: Action): Disposition;
  getPriorityLayer(): { handle(action: Action): Disposition } | null;
  handleShortcut(action: Action): Disposition; isFocusOwned(): boolean; getFocusOwner(): string;
  onDisable(): void; ownsKeyboardEvent(event: KeyboardEvent): boolean;
  openSearch(target: SearchTarget): void; prepareVideo(href: string | null): boolean;
  onSettingsClosed(): void; pageBack(): void; readonly navigating: boolean; readonly mode: Mode;
}
export interface SitePort extends WatchDataPort, SearchDataPort {
  hasNativeLayer(): boolean; perform(action: Action): OperationResult | Promise<OperationResult>;
  performWatchAction(action: WatchAction): OperationResult | Promise<OperationResult>;
  showNativeControls(): HTMLElement | null; isProgress(el: Element | null): boolean;
  createNavigationConfig(policy: NavigationPolicy): object;
  inspectWatchCapabilities(requireDestinationReady?: boolean): { ready: boolean; failed?: boolean; missing: readonly string[] };
  inspectOptionalCapabilities(): WatchFeatures;
  restoreNativeInterface(): void; syncCommentPreload(active: boolean): void;
  openRecommendation(key: string, prepareVideo: (href: string) => boolean): RecommendationResult;
  openChannel(beforeNavigate: () => void): boolean;
  expandReplies(key: string): boolean; loadComments(start?: boolean): OperationResult;
  loadRecommendations(): OperationResult;
  settingsOpen(): boolean; openSettings(): boolean; backSettings(menu?: Element): boolean;
  seekTo(time: number): boolean; observePage(onChange: () => void): Dispose;
  readBrowseAccount(): BrowseAccountSnapshot | null; openBrowseAccount(): boolean; destroy(): void;
}
export interface RoutePort {
  runtime: Runtime; interaction: InteractionStore; location: Location; history: History; window: Window; document: Document;
  routeNow(): string; renderMode(): void; hasTemporaryLayer(): boolean; enabled(): boolean;
  pause(): OperationResult; closeMenu(): void; onStart(): void;
}
export interface KeyboardKey { label: string; action: string; ariaLabel?: string; text?: string }
export interface PinyinCandidate { key: string; text: string; consumed: number }
export interface Pinyin { normalize(value: string): string; lookup(value: string): readonly PinyinCandidate[]; learn(candidate: PinyinCandidate): void }
export interface Keyboard { rows(frame: MenuSnapshot['frame'], uppercase: boolean): KeyboardKey[][] }
export interface SearchPort {
  root: ShadowRoot; host: HTMLElement; readonly controller: MenuPort;
  controllerStyle: ControllerStyle; pinyin: Pinyin; keyboard: Keyboard;
  selected: number; menuState(): MenuSnapshot; send(event: InteractionEvent): TransitionResult;
  buttons(): HTMLButtonElement[]; focus(): void; feedback(text: string): void; close(): void;
}
export type MakeNode = (tag: string, className?: string, text?: string) => HTMLElement;
export interface WatchViewDependencies {
  activate(action: string): void; closePanel(): void;
  controllerStyle: ControllerStyle; styles: { watch: string };
}
export interface WatchPanelsPort {
  make: MakeNode; dialog: HTMLElement; sheet: HTMLElement; panelTitle: HTMLElement;
  description: HTMLElement; close: HTMLElement; surface: HTMLElement;
  readonly controller: WatchPort; readonly descriptionText: string;
  watchState(): WatchSnapshot; send(event: InteractionEvent): TransitionResult; focus(): void;
  focusManager?: FocusManager; controllerStyle: ControllerStyle;
}
export interface MeasuredItem {
  el: HTMLElement; section: string; rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
  key?: string | Element; row?: string | Element | null;
}
export interface RowFocus {
  remember(item: MeasuredItem, items: MeasuredItem[], keepColumn?: boolean): void;
  target(from: MeasuredItem, next: MeasuredItem, items: MeasuredItem[]): MeasuredItem | undefined;
  reset(): void;
}
export interface NavigationSection { layout?: 'grid'; axis?: 'horizontal' | 'vertical'; alignRows?: boolean; retainRowFocus?: boolean; exits?: Partial<Record<Direction, string[]>> }
export interface Navigation {
  createRowFocus(): RowFocus;
  rowOf(from: MeasuredItem, items: MeasuredItem[]): MeasuredItem[];
  rowScroll(from: MeasuredItem, items: MeasuredItem[], viewport: { top: number; bottom: number }): number;
  choose(from: MeasuredItem, items: MeasuredItem[], direction: Direction, sections?: Record<string, NavigationSection>, rowFocus?: RowFocus): MeasuredItem | null;
}
export interface SharedDependencies { runtime: Runtime; interaction: InteractionStore; controllerStyle: ControllerStyle; focusManager?: FocusManager }
export interface CoreDependencies extends SharedDependencies { navigation: Navigation }
export interface CoreModule {
  registerSite(config: object): void; configure(values: Partial<Settings>): void;
  navigate(direction: Direction): void; act(action: Action): Disposition; focus(el: HTMLElement | null): void;
  resetContentFocus(): void; refresh(): void; destroy(): void;
  readonly hasTemporaryLayer: boolean; readonly hasOverlay: boolean;
    readonly current: HTMLElement | null; readonly section: string | undefined;
    readonly restoring: boolean;
}
export interface BrowseDependencies { runtime: Runtime; core: CoreModule; isMenuOpen(): boolean }
export interface SearchInstance {
  createInput(section: HTMLElement): void;
  render(section: HTMLElement, container: HTMLElement, message: HTMLElement, instructions: HTMLElement): void;
  navigate(action: Action): Disposition;
  keydown(event: KeyboardEvent): boolean; renderKeys(): void; refreshCandidates(): void;
  focusFirstKey(): void; focusCandidate(): void; keyboardAction(key: Pick<KeyboardKey, 'action'> & Partial<KeyboardKey>): void;
  space(): void; backspace(): void; pageCandidates(delta: number): void; toggleCandidates(): void;
  moveCursor(delta: number): void; submit(): void; setTarget(target: SearchTarget): void;
  readonly target: SearchTarget; initializeQuery(): void; destroy(): void;
}
export interface MenuDependencies extends SharedDependencies {
  styles: { menu: string };
  createSearch(port: Omit<SearchPort, 'controllerStyle' | 'pinyin' | 'keyboard'>): SearchInstance;
}
export interface WatchPanels {
  open(action: 'description' | 'comments'): void; hide(): void; close(): void;
  refresh(): void; load(): void; readonly buttons: HTMLElement[]; destroy(): void;
}
export type WatchView = Record<'host' | 'surface' | 'title' | 'meta' | 'progress' | 'fill' | 'elapsed' | 'duration'
  | 'avatarButton' | 'avatarImage' | 'avatarFallback' | 'subscribeButton' | 'playButton' | 'likeButton'
  | 'dislikeButton' | 'captionsButton' | 'recommendations' | 'empty' | 'dialog' | 'sheet' | 'panelTitle'
  | 'description' | 'close' | 'status' | 'hint' | 'liveButton', HTMLElement> & {
    root: ShadowRoot; make: MakeNode; icon(name: string): SVGSVGElement; controls: HTMLElement[];
    updateHint(row: WatchSnapshot['row'], adjusting: boolean, canSeek?: boolean): void;
  };
export interface WatchDependencies extends SharedDependencies {
  createView(port: Omit<WatchViewDependencies, 'styles'>): WatchView;
  createPanels(port: WatchPanelsPort): WatchPanels;
}
export interface CoordinatorModule {
  request: WatchRequest; setMode(mode: Mode): void; prepareVideo(href: string | null): boolean;
  checkAdaptation(): void; retryAdaptation(): void; destroy(): void;
  readonly adaptation: AdaptationSnapshot; readonly interactionState: InteractionSnapshot;
  readonly state: CoordinatorSnapshot; readonly mode: Mode; readonly navigating: boolean;
}
declare global {
  interface Window {
    YTGamepadRuntime: Runtime; YTGamepadInteraction: InteractionStore;
    YTGamepadStateMachine: {
      createState(route?: string): InteractionSnapshot;
      transition(state: InteractionSnapshot, event: InteractionEvent): TransitionResult;
      createStore(initial?: InteractionSnapshot): InteractionStore;
    };
    YTGamepadRouteState: {
      handles(type: string): boolean;
      transition(app: AppSnapshot, event: InteractionEvent): { app: AppSnapshot; effects: readonly Effect[]; disposition: Disposition };
    };
    YTGamepadFocus: FocusManager; YTGamepadNavigation: Navigation;
    YTGamepadBindings: { defaults: Record<string, number>; keys: Record<number, string>; labels: Record<string, string>; normalize(raw?: unknown): Record<string, number>; layouts: Record<string, string>; normalizeLayouts(raw?: unknown, legacy?: unknown): Record<string, Record<string, number>>; contextLabel(action: string, layout: string): string };
    YTGamepadControllerStyle: ControllerStyle; YTGamepadDiagnostics: Diagnostics;
    YTGamepadPinyin: Pinyin; YTGamepadKeyboard: Keyboard;
    YTGamepadStyles: { menu: string; watch: string };
    YTGamepad: CoreModule; YTGamepadMenu: MenuModule; YTGamepadWatch: WatchModule;
    YTGamepadSite: SitePort; YTGamepadInput: InputModule; YTGamepadCoordinator: CoordinatorModule;
    YTGamepadCoreModule: { create(dependencies: CoreDependencies): CoreModule };
    YTGamepadMenuModule: { create(dependencies: MenuDependencies): MenuModule };
    YTGamepadWatchModule: { create(dependencies: WatchDependencies): WatchModule };
    YTGamepadSiteModule: { create(dependencies: SiteDependencies): SitePort };
    YTGamepadInputModule: { create(dependencies: InputDependencies): InputModule };
    YTGamepadBrowseModule: { create(dependencies: BrowseDependencies): { destroy(): void } };
    YTGamepadSearch: { create(port: SearchPort): SearchInstance };
    YTGamepadWatchView: { create(port: WatchViewDependencies): WatchView };
    YTGamepadWatchPanels: { create(port: WatchPanelsPort): WatchPanels };
    YTGamepadRouteController: { create(port: RoutePort): {
      start(): void; prepareVideo(href: string | null): boolean; pageBack(): void; execute(effect: Effect): void; destroy(): void;
    } };
  }
}
