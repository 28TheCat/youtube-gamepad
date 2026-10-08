import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Options from '../settings/Options.vue';

const app = createApp(Options);
app.use(createPinia());
app.mount(document.getElementById('app')!);
window.addEventListener('pagehide', event => {
  if (!event.persisted) app.unmount();
});
