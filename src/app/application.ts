import { createVueWatchView } from '../ui/vue-watch-view';
import { ui } from '../ui/ui-api';
import { mountBrowseOverlay } from '../ui/browse-overlay';
import { mountBrowseSurface } from '../ui/browse-surface';
import { registerMainDispose } from './main-lifecycle.ts';
import { startCoordinator } from '../app/coordinator.ts';
import { YTGamepadRuntime } from '../shared/runtime.ts';
import { mountQuickMenu } from '../ui/quick-menu';
import { createPinia, disposePinia } from 'pinia';
import { useInteractionStore } from '../app/interaction-store';
import { createPageClient } from '../bridge/page-client';
import { createApplicationChannel } from '../bridge/local-channel';
import { startContent } from './content';
import { finishEarlyContent, abortEarlyContent } from './early-start';
import { waitForPageServer } from '../bridge/page-ready';
import { configureDiagnosticsChannel } from '../diagnostics/diagnostics';
import { mountBrowseCategorySettings } from '../sites/browse-category-settings';
export const localChannel = createApplicationChannel();
const startup = new AbortController();
const startupScope = YTGamepadRuntime.scope('startup');
startupScope.cleanup(ui.destroy);
startupScope.cleanup(() => { startup.abort(); abortEarlyContent(); });
startupScope.listen(window, 'pagehide', event => {
  if (!(event as PageTransitionEvent).persisted) YTGamepadRuntime.destroy();
});
registerMainDispose(() => YTGamepadRuntime.destroy());

async function startApplication() {
try {
const pageAccess = createPageClient();
startupScope.cleanup(() => pageAccess.destroy?.());
await waitForPageServer(pageAccess, startup.signal);
if (startup.signal.aborted) return;
// Missing MAIN keeps playback native through the existing capability checks.
// Subsequent checks can recover when the adapter becomes available.
const pinia = createPinia();
YTGamepadRuntime.scope('interaction').cleanup(() => disposePinia(pinia));
const interaction = useInteractionStore(pinia);
startCoordinator({ interaction, pageAccess, localChannel, remoteHistory: true, createWatchView: createVueWatchView, mountBrowseOverlay,
  mountBrowseGrid: dependencies => mountBrowseSurface(pinia, dependencies, localChannel),
  mountQuickMenu: (container, _interaction, items, onAction) => mountQuickMenu(pinia, container, items, onAction)
});
let settingsApplied!: () => void;
const initialSettings = new Promise<void>(resolve => { settingsApplied = resolve; });
const disposeContent = startContent(localChannel, () => YTGamepadRuntime.destroy(), settingsApplied);
if (startup.signal.aborted) return;
const extensionServices = YTGamepadRuntime.scope('extension-services');
extensionServices.cleanup(disposeContent);
extensionServices.cleanup(mountBrowseCategorySettings(YTGamepadRuntime));
configureDiagnosticsChannel(localChannel);
await initialSettings;
if (startup.signal.aborted) return;
finishEarlyContent();
} catch (error) {
  YTGamepadRuntime.destroy();
  console.error('YouTube Gamepad startup:', error);
}
}
void startApplication();
