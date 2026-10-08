import { createApp } from 'vue';
import type { Pinia } from 'pinia';
import QuickMenu from './QuickMenu.vue';

export function mountQuickMenu(pinia: Pinia, container: HTMLElement,
  items: readonly (readonly [string, string])[],
  onAction: (id: string, button: HTMLButtonElement) => void) {
  const app = createApp(QuickMenu, { items, onAction });
  app.use(pinia);
  try { app.mount(container); }
  catch (error) { app.unmount(); throw error; }
  return () => app.unmount();
}
