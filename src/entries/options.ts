import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Options from '../settings/Options.vue';
import { syncLanguage } from '../shared/i18n';
const stopLanguage = syncLanguage();

const app = createApp(Options);
app.use(createPinia());
app.mount(document.getElementById('app')!);
window.addEventListener('pagehide', event => {
  if (!event.persisted) { app.unmount(); stopLanguage(); }
});
