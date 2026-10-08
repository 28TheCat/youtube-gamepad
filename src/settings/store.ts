import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import { loadSettings, normalizeSettings, settingDefaults, type SettingKey } from '../shared/settings';

export const useSettingsStore = defineStore('settings', () => {
  const values = reactive({ ...settingDefaults });
  const ready = ref(false);
  const saving = ref(false);
  const status = ref('');
  const statusVisible = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function feedback(text: string, success = false) {
    if (disposed) return;
    clearTimeout(timer);
    status.value = text;
    statusVisible.value = true;
    if (success) timer = setTimeout(() => { statusVisible.value = false; }, 2000);
  }
  async function initialize() {
    try {
      const stored = await loadSettings();
      if (disposed) return;
      Object.assign(values, stored);
      ready.value = true;
    } catch { feedback('Could not load settings. Please reopen this page.'); }
  }
  async function saveValues(next: Partial<typeof values>) {
    if (!ready.value || disposed || saving.value) return;
    saving.value = true;
    try { await chrome.storage.local.set(next); if (!disposed) { Object.assign(values, normalizeSettings({ ...values, ...next })); feedback("Saved", true); } }
    catch { feedback("Could not save. Please try again."); }
    finally { saving.value = false; }
  }
  async function save(key: SettingKey, event: Event) {
    if (!ready.value || disposed || saving.value) return;
    const input = event.target as HTMLInputElement;
    if (!input.checkValidity()) {
      input.reportValidity();
      feedback('Please enter a valid number within the shown range');
      return;
    }
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    saving.value = true;
    try {
      await chrome.storage.local.set({ [key]: value });
      if (disposed) return;
      Object.assign(values, normalizeSettings({ ...values, [key]: value }));
      feedback('Saved', true);
    } catch {
      // Vue must also repaint a DOM control that was changed by the user.
      if (input.type === 'checkbox') input.checked = values[key] as boolean;
      else input.value = String(values[key]);
      feedback('Could not save. Please try again.');
    } finally { saving.value = false; }
  }
  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local' || !ready.value || disposed) return;
    const next: Record<string, unknown> = { ...values };
    for (const key of Object.keys(settingDefaults))
      if (changes[key]) next[key] = changes[key].newValue ?? settingDefaults[key as SettingKey];
    Object.assign(values, normalizeSettings(next));
  }
  function dispose() { disposed = true; clearTimeout(timer); }
  return { values, ready, saving, status, statusVisible, feedback, initialize, save, saveValues, changed, dispose };
});
