import { createApp } from 'vue';
import InlineSettings from './InlineSettings.vue';
// Runs only in ISOLATED. Keep the bridge's mount/dispose contract while Vue
// owns the panel contents and storage writes originate in UI handlers.
export const YTGamepadInlineSettings = {
  mount(root: ShadowRoot|null|undefined, container: string|Element) {
    const app = createApp(InlineSettings, { root, container });
    app.mount(container);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      app.unmount();
    };
  }
};
