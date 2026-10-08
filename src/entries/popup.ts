import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Popup from '../popup/Popup.vue';

const app = createApp(Popup);
app.use(createPinia());
app.mount(document.getElementById('app')!);
window.addEventListener('pagehide', event => {
  if (!event.persisted) app.unmount();
});
