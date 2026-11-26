import { createPinia } from 'pinia';
import { useInteractionStore } from '../../src/app/interaction-store';
import { YTGamepadRuntime as runtime } from '../../src/shared/runtime';
import { YTGamepadFocus as focusManager } from '../../src/navigation/focus';
import { YTGamepadWatchModule } from '../../src/playback/watch';
import { createWatchSurface } from '../../src/ui/watch-surface';
import { createVueWatchView } from '../../src/ui/vue-watch-view';
import { YTGamepadWatchPanels } from '../../src/ui/watch-panels';
import { YTGamepadMenuModule } from '../../src/ui/menu';
import { mountQuickMenu } from '../../src/ui/quick-menu';
import { YTGamepadStyles as styles } from '../../src/ui/styles';

export function setup(commentText = '') {
  const pinia = createPinia(), interaction = useInteractionStore(pinia);
  const commands: unknown[][] = [];
  const controllerStyle = { register: () => () => {}, badge() {}, bind(node: HTMLElement, text: string, attribute?: string) {
    if (attribute) node.setAttribute(attribute, text); else node.textContent = text;
  }, hint(node: HTMLElement, text: string) { node.textContent = text; } };
  const shared = { runtime, interaction, controllerStyle, focusManager };
  let mode = 'controls';
  const page = { key: location.pathname + location.search, isWatch: true, title: 'A quieter fullscreen player', channel: 'Creator',
    description: 'Details remain available from More actions.', recommendations: [], subscribed: false, liked: false, disliked: false };
  const playback = { video: { paused: true, currentTime: 30, duration: 120, volume: .5, muted: false,
    timeline: { isLive: false, canSeek: true, start: 0, end: 120, atLiveEdge: false } }, settingsOpen: false, captionsEnabled: false };
  const watch = YTGamepadWatchModule.create({ ...shared, createSurface: (callbacks, lifecycle) => createWatchSurface({ ...shared,
    createView: port => createVueWatchView({ ...port, styles }), createPanels: port => YTGamepadWatchPanels.create(port)
  }, callbacks, lifecycle) });
  const menu = YTGamepadMenuModule.create({ ...shared, styles,
    createSearch: () => ({ setTarget() {}, unmount() {}, destroy() {} } as any),
    mountQuickMenu: (container, _interaction, items, onAction) => mountQuickMenu(pinia, container, items, onAction)
  });
  const port = { state: { enabled: true, shellVisible: true, surfaceReady: true, navigating: false, get mode() { return mode; } }, navigating: false,
    readRoute: () => ({ key: page.key, isWatch: true }), readWatchPage: () => ({ ...page }), readPlayback: () => ({ ...playback, video: { ...playback.video } }),
    readWatchFeatures: () => ({}), readComments: () => commentText ? [{ key: 'long', author: 'Viewer', text: commentText,
      hasReplies: false, replies: [] }] : [], observePlayback() {},
    hasTemporaryLayer: () => menu.opened || !!interaction.state.watch.panel,
    dispatchAction: (action: any) => menu.opened ? menu.handle(action) : watch.handleInput(action),
    requestRefresh: () => watch.sync(),
    request(type: string, value?: unknown) {
      commands.push([type, value]);
      if (type === 'backSettings') {
        const opened = playback.settingsOpen;
        playback.settingsOpen = false;
        return opened;
      }
      if (type === 'mode') { mode = value as string; watch.sync(); }
      if (type === 'watchAction' && value === 'like') page.liked = !page.liked;
      if (type === 'watchAction' && value === 'subscribe') page.subscribed = true;
      if (type === 'media' && value === 'playPause') playback.video.paused = !playback.video.paused;
      if (type === 'media' && value === 'captions') playback.captionsEnabled = !playback.captionsEnabled;
      if (type === 'media' && value === 'seekForward') playback.video.currentTime += 10;
      if (type === 'playlists') return [];
      return true;
    }
  };
  watch.connect(port as any);
  menu.connect({ interactionChanged() {}, perform: action => port.request('media', action),
    dispatchAction: port.dispatchAction, getSearchTarget: () => null } as any);
  watch.sync(); watch.show();
  return { watch, menu, commands, page, playback,
    press: (action: any) => menu.opened ? menu.handle(action) : watch.handleInput(action),
    destroy: () => runtime.destroy() };
}
