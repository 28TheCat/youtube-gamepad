import type { HomeFilterSettings } from '../src/shared/home-filter';
/** Shared source contracts. Snapshots contain data; DOM handles stay in ports.
 * The Window declarations at the bottom support legacy test fixtures only. */
export type Mode = 'browse' | 'playback' | 'controls';
export type Disposition = 'handled' | 'blocked' | 'pass';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Action = Direction | 'confirm' | 'back' | 'help' | 'search' | 'playPause'
  | 'goLive' | 'pause' | 'mute' | 'captions' | 'volumeDown' | 'volumeUp' | 'seekBack' | 'seekForward'
  | 'keyboardSymbols' | 'keyboardCandidates';
export type WatchAction = 'subscribe' | 'unsubscribe' | 'notificationsAll' | 'notificationsPersonalized' | 'notificationsNone' | 'like' | 'dislike' | 'save';
export type NotificationPreference = 'ALL' | 'PERSONALIZED' | 'NONE';
export interface SavedPlaylistSnapshot { readonly key: string; readonly title: string; readonly selected: boolean }
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
  readonly seekStep?: number;
  readonly video: VideoSnapshot | null;
  readonly captionsEnabled: boolean; readonly settingsOpen: boolean;
}
export interface RecommendationSnapshot {
  readonly channelBadge?: 'verified' | 'artist';
  readonly href?: string; readonly queue?: boolean; readonly selected?: boolean;
  readonly metadata?: string; readonly viewCount?: string; readonly duration?: string; readonly watchedPercent?: number;
  readonly key: string; readonly label: string; readonly channel: string;
  readonly thumbnail: string; readonly thumbnailFallback: string;
  readonly isPlaylist?: boolean;
}
export interface WatchPageSnapshot extends RouteSnapshot {
  readonly channelBadge?: 'verified' | 'artist';
  readonly queue?: readonly RecommendationSnapshot[];
  readonly playlistTitle?: string;
  readonly title: string; readonly channel: string; readonly description: string;
  readonly recommendations: readonly RecommendationSnapshot[];
  // Optional because the existing degraded read returns a minimal page snapshot.
  readonly notificationPreference?: NotificationPreference;
  readonly waiting?: boolean; readonly avatar?: string; readonly subscribed?: boolean;
  readonly liked?: boolean; readonly disliked?: boolean; readonly viewCount?: string | number | null;
}
export interface CommentReplySnapshot {
  readonly key: string; readonly author: string; readonly text: string;
  readonly avatar?: string;
  readonly translationTarget?: string;
  readonly translation?: { readonly language: string; readonly text?: string; readonly loading: boolean; readonly failed: boolean };
}
export interface CommentSnapshot extends CommentReplySnapshot {
  readonly canReply?: boolean;
  readonly replyCount?: number;
  readonly hasReplies: boolean; readonly repliesLabel: string;
  readonly replies: readonly CommentReplySnapshot[];
}
export type WatchFeatures = Readonly<Partial<Record<'metadata' | 'recommendations' | 'comments'
  | 'channel' | 'captions' | 'settings' | 'subscribe' | 'like' | 'dislike' | 'save' | 'nativeLayers', Capability>>>;
export interface AdaptationSnapshot { readonly status: 'inactive' | 'waiting' | 'ready' | 'fallback'; readonly reason: string; readonly route?: string }
export interface CoordinatorSnapshot { readonly mode: Mode; readonly enabled: boolean; readonly surfaceReady: boolean; readonly navigating: boolean }
export interface Settings extends Partial<HomeFilterSettings> { seekStep?: number; shortsSeekStep?: number; volumeStep?: number; playbackLayout?: 'fullscreen' | 'windowed'; rightHandMode?: boolean; enabled: boolean; theater: boolean; deadzone: number; repeatDelay: number; repeatInterval: number; bindings?: Record<string, number>; bindingLayouts?: Record<string, Record<string, number>>; shortcutLayouts?: Record<string, Record<string, string>> }
export type SearchTarget = HTMLInputElement | null;
export type OperationResult = boolean | void;
export type RecommendationResult = 'opened' | 'blocked' | 'missing';
export interface CommentsStatus {
  route?: string; loading: boolean; failed: boolean; hasMore: boolean;
  interaction?: { signedIn: boolean; canPost: boolean; sort: 'TOP_COMMENTS' | 'NEWEST_FIRST'; sortAvailable: boolean; posting: boolean };
}
export interface WatchDataPort {
  readCommentsStatus?(): CommentsStatus | undefined;
  readRoute(): RouteSnapshot;
  readWatchPage(): WatchPageSnapshot;
  readPlayback(): PlaybackSnapshot;
  readComments(): readonly CommentSnapshot[];
  readWatchFeatures?(): WatchFeatures;
}
export interface WatchRequest {
  (type: 'commentPost', value: { text: string; key?: string }): OperationResult | Promise<OperationResult>;
  (type: 'commentSort', value: 'TOP_COMMENTS' | 'NEWEST_FIRST'): OperationResult;
  (type: 'fullscreen'): OperationResult | Promise<OperationResult>;
  (type: 'moreRecommendations'): OperationResult;
  (type: 'mode', value: Mode): OperationResult;
  (type: 'media', value: Action): OperationResult | Promise<OperationResult>;
  (type: 'watchAction', value: WatchAction): OperationResult | Promise<OperationResult>;
  (type: 'playlists'): false | Promise<readonly SavedPlaylistSnapshot[] | undefined>;
  (type: 'savePlaylist', value: string): OperationResult | Promise<OperationResult>;
  (type: 'seek', value: number): OperationResult;
  (type: 'recommendation', value: string): RecommendationResult | false;
  (type: 'replies', value: string): OperationResult;
  (type: 'translateComment', value: string): OperationResult;
  (type: 'comments', value?: boolean): OperationResult;
  (type: 'settings' | 'backSettings' | 'channel'): OperationResult;
}
export interface WatchPort extends WatchDataPort {
  readonly state: CoordinatorSnapshot; readonly navigating: boolean;
  request: WatchRequest;
  observePlayback(playback: PlaybackSnapshot): void;
  hasTemporaryLayer(): boolean; hasNativeLayer(): boolean;
  requestAutoHide(idle: number): void;
  requestRefresh?(page?: boolean): void;
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
  readonly row: 'player' | 'metadata' | 'controls' | 'progress' | 'recommendations'; readonly index: number;
  readonly controlIndex: number; readonly recommendationIndex: number; readonly adjusting: boolean;
  readonly panel: '' | 'description' | 'comments' | 'playlists' | 'subscription'; readonly panelIndex: number; readonly playIndex: number;
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
export type RouteEvent =
  | { type: 'PREPARE_VIDEO'; target: string; route: string }
  | { type: 'NAV_START' }
  | { type: 'HISTORY'; method: string; route: string; changed: boolean }
  | { type: 'NAV_FINISH' | 'NAV_CANCEL' | 'POPSTATE'; route: string }
  | { type: 'PAGE_BACK'; route: string; temporaryLayer: boolean };
export type InteractionEvent = RouteEvent
  | { type: 'APP_INIT'; route: string }
  | { type: 'ADAPTATION'; route: string; status: AdaptationSnapshot['status']; reason?: string }
  | { type: 'MODE'; route: string; value: Mode }
  | { type: 'ENABLE'; route: string; enabled: boolean }
  | { type: 'AUTO_HIDE'; playing: boolean; temporaryLayer: boolean; idle: number }
  | { type: 'INPUT_OWNER'; enabled: boolean; navigating: boolean; menu: boolean; native: boolean; panel: boolean; help: boolean; action: Action }
  | { type: 'BASE_INPUT'; route: string; action: Action }
  | { type: 'NATIVE_CONTROLS_INPUT'; route: string; action: Action; progress: boolean }
  | { type: 'WATCH_RESET'; playIndex?: number }
  | { type: 'WATCH_CONTROL_LAYOUT'; playIndex: number; index: number }
  | { type: 'WATCH_SHOW'; target: 'controls' | 'recommendations'; count: number }
  | { type: 'WATCH_FOCUS'; region: WatchSnapshot['row'] | 'panel'; index?: number }
  | { type: 'WATCH_PANEL'; panel: WatchSnapshot['panel'] }
  | { type: 'WATCH_PANEL_COUNT'; count: number }
  | { type: 'WATCH_EMPTY' }
  | { type: 'WATCH_INPUT'; action: Action; windowed?: boolean; scrollDelta?: number; commentCount: number; recommendationKey?: string; controlAction?: string; cardColumns?: number; cardCount: number; controlCount: number; availableControls?: number[]; canSeek?: boolean }
  | { type: 'MENU_OPEN' | 'MENU_CLOSE' | 'MENU_SHIFT' | 'MENU_MAIN' | 'MENU_BACK' }
  | { type: 'MENU_SEARCH'; selected: number }
  | { type: 'MENU_SET_LANGUAGE'; value: MenuSnapshot['language'] }
  | { type: 'MENU_COMPOSE'; value: string }
  | { type: 'MENU_PAGE'; delta: number }
  | { type: 'MENU_FRAME'; value: MenuSnapshot['frame'] }
  | { type: 'MENU_LANGUAGE'; value: boolean }
  | { type: 'MENU_INPUT'; action: Action };
export interface InteractionStore {
  readonly state: InteractionSnapshot;
  dispatch(event: InteractionEvent): TransitionResult;
}
export type Dispose = () => void;
/** In-process messages only. Consumers supply a discriminated message union. */
export interface LocalMessage { readonly type: string }
export interface LocalChannel<Message extends LocalMessage = LocalMessage> {
  publish(message: Message): void;
  subscribe(listener: (message: Message) => void): Dispose;
}
export interface Scope {
  readonly destroyed: boolean; readonly size: number;
  cleanup(dispose: Dispose): Dispose;
  listen<K extends keyof WindowEventMap>(target: EventTarget, type: K, listener: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): Dispose;
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
  use(pad: Pick<Gamepad, 'id'> | null | undefined): void;
  readonly css: string;
  register(root: ShadowRoot | Document): Dispose;
  hint<T extends HTMLElement>(node: T, text: string): T;
  bind<T extends HTMLElement>(node: T, text: string, attribute?: string): T;
  badge<T extends HTMLElement>(node: T, key: string): T;
  configureBindings(raw?: unknown): void;
  identify(id?: string): ControllerStyle['family']; format(text: string): string;
}
export interface FocusTarget {
  region: string; itemKey?: string | Element; index?: number; scope?: Document | Element; el?: HTMLElement;
  pageScroll?: { x: number; y: number } | null;
}
export interface FocusRecord extends FocusTarget { owner: string; routeKey: string; keys: readonly (string | Element | undefined)[]; occurrence?: number }
export interface FocusOwner {
  active(): boolean; capture(): FocusTarget | null | undefined;
  items(region: string, target: FocusTarget): readonly FocusTarget[];
  fallback(target?: FocusTarget | null): FocusTarget;
  apply(target: FocusTarget, saved?: FocusRecord | null): void;
}
export interface FocusManager {
  readonly suspended: boolean; register(owner: string, adapter: FocusOwner): Dispose;
  capture(preferred?: string): FocusRecord | null;
  restore(target: FocusRecord | null): void;
  open(token: Document | Element, preferred?: string, priority?: number): void;
  close(token: Document | Element, apply?: boolean): void;
  isSuspendedScope(scope: Element): boolean;
}
export interface DiagnosticState { route?: string; mode?: Mode; adaptation?: string; enabled?: boolean; surfaceReady?: boolean; navigating?: boolean }
export interface Diagnostics { record(module: string, operation: string, error: unknown, state?: DiagnosticState): void }
export interface ApplicationMessage { source: string; values?: Settings; entry?: unknown }
export interface ApplicationChannel { publish(message: ApplicationMessage): void; subscribe(listener: (message: ApplicationMessage) => void): Dispose }
export interface InputDependencies { localChannel?: ApplicationChannel; runtime: Runtime; controllerStyle: ControllerStyle; isSearchOpen(): boolean; temporarySpeed?(held: boolean): boolean; canRepeatMedia?(): boolean; canHandleInput?(): boolean; scroll?(delta: number): void }
export interface SiteDependencies { pageAccess?: import("../src/bridge/page-protocol").PageAccess; runtime: Runtime; diagnostics?: Diagnostics; focusManager?: FocusManager }
  export interface InputSourceTrace { source: string; decision: 'switch' | 'preserve' | 'ignored'; previousMode: 'mouse' | 'gamepad' | 'keyboard'; mode: 'mouse' | 'gamepad' | 'keyboard'; time: number }
  export interface InputModule { readonly connected: boolean; readonly mode: 'mouse' | 'gamepad' | 'keyboard'; readonly recentSources?: readonly InputSourceTrace[]; isHeld?(action: Action): boolean; cancelSeeking?(): void; configure(values: Partial<Settings>): void; destroy(): void }
export interface MenuModule { readonly opened: boolean; readonly settingsOpened?: boolean; readonly state: MenuSnapshot; connect(port: MenuPort): void; close(): void; openSearch(target?: SearchTarget): void; handle(action: Action): Disposition; scroll?(delta: number): void; destroy(): void }
export interface WatchModule {
  checkIdle?(): void;
  refreshPage?(): void;
  refreshPlayback?(): void;
  readonly ownsFocus: boolean;
  readonly state: Pick<WatchSnapshot, 'row' | 'index' | 'adjusting' | 'panel'> & { readonly mode: Mode; readonly recommendations: number };
  connect(port: WatchPort): void; sync(mode?: Mode, preferences?: Partial<Settings>): void;
  show(target?: 'controls' | 'recommendations'): void; handle(action: Action): boolean;
  handleInput(action: Action): Disposition; refresh(): void; destroy(): void;
  scroll?(delta: number): void;
  mediaFeedback(action: Action, seekDelta?: number): void;
  seekPreview?(value: import('../src/ui/playback-presentation').SeekPreview | null): void;
}
export interface ActionContext { current?: HTMLElement | null; scope: Document | Element }
export interface NavigationPolicy {
  perform(action: Action): OperationResult | Promise<OperationResult>;
  shouldShowSelection(context: ActionContext): boolean;
  interceptAction(action: Action, context?: Partial<ActionContext>): boolean;
  handleRegion(action: Action, context: ActionContext): Disposition;
  handleBase(action: Action, context: ActionContext): Disposition;
  onScopeChange(scope?: Document | Element): void; isNavigating(): boolean; getInputLayer(): string | null;
  handleLayer(action: Action): Disposition;
  getPriorityLayer(): { handle(action: Action): Disposition } | null;
  handleShortcut(action: Action): Disposition; isFocusOwned(): boolean; getFocusOwner(): string;
  onDisable(): void; ownsKeyboardEvent(event: KeyboardEvent): boolean;
  openSearch(target: SearchTarget): void; prepareVideo(href: string | null): boolean;
  onSettingsClosed(): void; pageBack(): void; readonly navigating: boolean; readonly mode: Mode;
}
export interface SitePort extends WatchDataPort, SearchDataPort {
  configurePlayback?(values: Partial<import('../src/shared/playback-settings').PlaybackParameters>): void;
  temporarySpeed(held: boolean): number | false;
  hasNativeLayer(): boolean; perform(action: Action): OperationResult | Promise<OperationResult>;
  performWatchAction(action: WatchAction): OperationResult | Promise<OperationResult>;
  listPlaylists(): Promise<readonly SavedPlaylistSnapshot[] | undefined>;
  togglePlaylist(key: string): Promise<boolean>;
  showNativeControls(): HTMLElement | null; isProgress(el: Element | null): boolean;
  createNavigationConfig(policy: NavigationPolicy): import('./core').NavigationConfig;
  inspectWatchCapabilities(requireDestinationReady?: boolean): { ready: boolean; failed?: boolean; missing: readonly string[] };
  inspectOptionalCapabilities(): WatchFeatures;
  restoreNativeInterface(): void;
  openRecommendation(key: string, prepareVideo: (href: string) => boolean): RecommendationResult;
  openChannel(beforeNavigate: () => void): boolean;
  expandReplies(key: string): boolean; loadComments(start?: boolean): OperationResult;
  translateComment(key: string): boolean;
  postComment?(text: string, key?: string): Promise<boolean>;
  sortComments?(sort: 'TOP_COMMENTS' | 'NEWEST_FIRST'): boolean;
  loadRecommendations(): OperationResult;
  settingsOpen(): boolean; openSettings(): boolean; backSettings(menu?: HTMLElement | null): boolean;
  seekTo(time: number): boolean; observePage(onChange: () => void): Dispose;
  destroy(): void;
}
export interface RoutePort {
  remoteHistory?: boolean; runtime: Runtime; interaction: InteractionStore; location: Location; history: History; window: Window; document: Document;
  routeNow(): string; renderMode(): void; hasTemporaryLayer(): boolean; enabled(): boolean;
  pause(): OperationResult; closeMenu(): void; onStart(): void;
}
export interface KeyboardKey { label: string; action: string; ariaLabel?: string; text?: string }
export interface PinyinCandidate { key: string; text: string; consumed: number }
export interface Pinyin { normalize(value: string): string; lookup(value: string): readonly PinyinCandidate[]; learn(candidate: PinyinCandidate): void }
export interface Keyboard { readonly frames: Map<string, KeyboardKey[][]>; rows(frame: MenuSnapshot['frame'], uppercase: boolean): KeyboardKey[][] }
export interface SearchPort {
  root: ShadowRoot; host: HTMLElement; readonly controller: MenuPort;
  controllerStyle: ControllerStyle; pinyin: Pinyin; keyboard: Keyboard;
  selected: number; menuState(): MenuSnapshot; send(event: InteractionEvent): TransitionResult;
  buttons(): HTMLButtonElement[]; focus(): void; feedback(text: string): void; close(): void;
}
export type MakeNode = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];
export interface WatchViewDependencies {
  activate(action: string): void; closePanel(): void;
  seek?(seconds: number): OperationResult | Promise<OperationResult>;
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
export interface CoreDependencies extends SharedDependencies {
  navigation: Navigation;
  mountOverlay?: (root: ShadowRoot, style: ControllerStyle) => import('../src/ui/browse-overlay').BrowseOverlayPresenter;
}
export interface CoreModule {
  registerSite(config: import('./core').NavigationConfig): void; configure(values: Partial<Settings>): void;
  navigate(direction: Direction): void; act(action: Action): Disposition; focus(el: HTMLElement | null): void;
  scroll?(delta: number): void;
  resetContentFocus(): void; refresh(): void; destroy(): void;
  readonly hasTemporaryLayer: boolean; readonly hasOverlay: boolean;
    readonly current: HTMLElement | null; readonly section: string | undefined;
    readonly restoring: boolean;
}
export interface BrowseDependencies {
  runtime: Runtime; core: CoreModule; isMenuOpen(): boolean;
  prepareVideo?: (href: string) => boolean;
  mountGrid?: (dependencies: BrowseDependencies) => Dispose;
}
export interface SearchInstance {
  unmount?(): void;
  render(section: HTMLElement): void;
  navigate(action: Action): Disposition;
  keydown(event: KeyboardEvent): boolean; renderKeys(): void; refreshCandidates(): void;
  focusFirstKey(): void; keyboardAction(key: Pick<KeyboardKey, 'action'> & Partial<KeyboardKey>): void;
  space(): void; backspace(): void; pageCandidates(delta: number): void; toggleCandidates(): void;
  moveCursor(delta: number): void; submit(): void; setTarget(target: SearchTarget): void;
  readonly target: SearchTarget; initializeQuery(): void; destroy(): void;
}
export interface MenuDependencies extends SharedDependencies {
  localChannel?: ApplicationChannel;
  styles: { menu: string };
  mountQuickMenu?: (container: HTMLElement, interaction: InteractionStore,
    items: readonly (readonly [string, string])[],
    onAction: (id: string, button: HTMLButtonElement) => void) => Dispose;
  createSearch(port: Omit<SearchPort, 'controllerStyle' | 'pinyin' | 'keyboard'>): SearchInstance;
}
export interface WatchPanels {
  open(action: 'description' | 'comments' | 'playlists' | 'subscription'): void; hide(): void; close(): void;
  back(): boolean;
  refresh(): void; load(): void; readonly buttons: HTMLElement[]; destroy(): void;
}
export type WatchView = Record<'host' | 'surface' | 'recommendations' | 'dialog' | 'sheet' | 'panelTitle'
  | 'description' | 'close' | 'status', HTMLElement> & {
    controls: HTMLButtonElement[]; progress: HTMLButtonElement; player?: HTMLButtonElement; metadata?: HTMLElement;
    root: ShadowRoot; make: MakeNode;
    cycleTab?(direction: number): boolean;
    updateHint(row: WatchSnapshot['row'], adjusting: boolean, canSeek?: boolean): void;
    presentation: import('../src/ui/playback-presentation').PlaybackPresenter;
  };
export interface WatchDependencies extends SharedDependencies {
  createSurface(callbacks: import('../src/ui/watch-surface').WatchSurfaceCallbacks, lifecycle: Scope): import('../src/ui/watch-surface').WatchSurface;
}
export interface CoordinatorModule {
  request: WatchRequest; setMode(mode: Mode): void; prepareVideo(href: string | null): boolean;
  checkAdaptation(): void; retryAdaptation(): void; destroy(): void;
  readonly adaptation: AdaptationSnapshot; readonly interactionState: InteractionSnapshot;
  readonly state: CoordinatorSnapshot; readonly mode: Mode; readonly navigating: boolean;
}
export interface ModuleFactory<Dependencies, Instance> { create(dependencies: Dependencies): Instance }
export interface StateMachineModule {
  createState(route?: string): InteractionSnapshot;
  transition(state: InteractionSnapshot, event: InteractionEvent): TransitionResult;
  freezeSnapshot(state: InteractionSnapshot): InteractionSnapshot;
}
export interface RouteStateModule {
  handles(type: string): boolean;
  transition(app: AppSnapshot, event: RouteEvent): { app: AppSnapshot; effects: readonly Effect[]; disposition: Disposition };
}
export interface BindingsSchema {
    keyboardActions: Record<string, string>;
    normalizeShortcuts(raw?: unknown): Record<string, Record<string, string>>;
    shortcutLabel(key: string): string;
  defaults: Record<string,number>; rightHand: Record<string,number>; keys: Record<number,string>; labels: Record<string,string>; layouts: Record<string,string>;
  normalize(raw?: unknown): Record<string,number>;
  normalizeLayouts(raw?: unknown, legacy?: unknown): Record<string,Record<string,number>>;
  contextLabel(action: string, layout: string): string;
}
export interface RouteControllerModule {
  start(): void; prepareVideo(href: string | null): boolean; pageBack(): void; execute(effect: Effect): void; destroy(): void;
}
declare global {
  interface Window {
    YTGamepadRuntime: Runtime; YTGamepadInteraction: InteractionStore;
    YTGamepadStateMachine: {
      createState(route?: string): InteractionSnapshot;
      transition(state: InteractionSnapshot, event: InteractionEvent): TransitionResult;
      freezeSnapshot(state: InteractionSnapshot): InteractionSnapshot;
    };
    YTGamepadRouteState: {
      handles(type: string): boolean;
      transition(app: AppSnapshot, event: RouteEvent): { app: AppSnapshot; effects: readonly Effect[]; disposition: Disposition };
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
    YTGamepadWatchPanels: { create(port: WatchPanelsPort): WatchPanels };
    YTGamepadRouteController: { create(port: RoutePort): {
      start(): void; prepareVideo(href: string | null): boolean; pageBack(): void; execute(effect: Effect): void; destroy(): void;
    } };
  }
}
