import type { WatchPort, MenuPort, WatchPageSnapshot, PlaybackSnapshot, CommentSnapshot } from '../../types/ports.js';

declare const watch: WatchPort;
declare const menu: MenuPort;
const page: WatchPageSnapshot = watch.readWatchPage();
const playback: PlaybackSnapshot = watch.readPlayback();
const comments: readonly CommentSnapshot[] = watch.readComments();
watch.request('mode', 'controls');
watch.request('seek', playback.video?.currentTime ?? 0);
watch.request('recommendation', page.recommendations[0].key);
watch.request('replies', comments[0].key);
menu.submitSearch(null, 'query', () => {});
menu.syncSearch(null, 'query', [0, 5]);
const dark: boolean = menu.readTheme();
void dark;
// @ts-expect-error cursor offsets use a start/end pair
menu.moveSearchCursor(null, 3);
// @ts-expect-error seek values are numeric
watch.request('seek', '10');
// @ts-expect-error modes are a closed set
watch.request('mode', 'fullscreen');
// @ts-expect-error read-only media data cannot be used as a native video handle
playback.video?.play();
// @ts-expect-error recommendations contain operation keys, never native links
page.recommendations[0].click();
// @ts-expect-error snapshots cannot be mutated by views
page.title = 'changed';
// @ts-expect-error comments expose data, never DOM nodes
comments[0].appendChild(document.createElement('div'));
// Legacy global entry points share the same typed port contracts.
window.YTGamepadWatch.connect(watch);
window.YTGamepadMenu.connect(menu);
// @ts-expect-error factories require the explicit input observation callback
window.YTGamepadInputModule.create({ runtime: window.YTGamepadRuntime, controllerStyle: window.YTGamepadControllerStyle });

// Event discriminants must retain their corresponding payload contracts.
import type { InteractionStore } from '../../types/ports.js';
declare const interaction: InteractionStore;
interaction.dispatch({ type: 'MODE', route: '/watch?v=test', value: 'controls' });
interaction.dispatch({ type: 'MENU_SET_LANGUAGE', value: 'en' });
// @ts-expect-error fullscreen is a browser state rather than an interaction mode
interaction.dispatch({ type: 'MODE', route: '/watch?v=test', value: 'fullscreen' });
// @ts-expect-error watch input requires current collection sizes
interaction.dispatch({ type: 'WATCH_INPUT', action: 'confirm' });
// @ts-expect-error search languages are a closed set
interaction.dispatch({ type: 'MENU_SET_LANGUAGE', value: 'invalid-language' });
