<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import BindingRow from './BindingRow.vue';
import { actions, schema, swapBinding, positionsOnPad, type BindingAction, type Layout } from './bindings';
import { useSettingsStore } from './store';
const settings = useSettingsStore();
const layout = ref<Layout>('watch'), layouts = ref(schema.normalizeLayouts());
const ready = ref(false), saving = ref(false), active = ref<BindingAction>();
const values = computed(() => layouts.value[layout.value]);
const disabled = computed(() => saving.value || !ready.value);
const left = actions.filter(action => ['seekBack', 'seekForward', 'volumeDown', 'volumeUp'].includes(action));
const right = actions.filter(action => !left.includes(action) && action !== 'help' && !action.startsWith('keyboard'));
const keyboard = actions.filter(action => action.startsWith('keyboard'));
const layoutImage = chrome.runtime.getURL('assets/controller/layout.svg');
let disposed = false, revision = 0;
async function reload() {
  const request = ++revision;
  try {
    const stored = await chrome.storage.local.get({ bindings: {}, bindingLayouts: null });
    if (!disposed && request === revision) { layouts.value = schema.normalizeLayouts(stored.bindingLayouts, stored.bindings); ready.value = true; }
  } catch { settings.feedback('Could not load bindings. Please reopen this page.'); }
}
async function save(next: typeof values.value, message: string) {
  if (disabled.value) return;
  const selected = layout.value;
  saving.value = true;
  try {
    // Read again so editing one layout preserves changes made by another page.
    const stored = await chrome.storage.local.get({ bindings: {}, bindingLayouts: null });
    const nextLayouts = { ...schema.normalizeLayouts(stored.bindingLayouts, stored.bindings), [selected]: next };
    await chrome.storage.local.set({ bindingLayouts: nextLayouts, bindings: nextLayouts.watch });
    if (!disposed) { layouts.value = nextLayouts; settings.feedback(message, true); }
  } catch { settings.feedback('Could not save bindings. Please try again.'); }
  finally { saving.value = false; await reload(); }
}
async function change(action: BindingAction, event: Event) {
  const input = event.target as HTMLSelectElement;
  const { next, conflict } = swapBinding(values.value, action, Number(input.value));
  await save(next, conflict ? `Saved. Swapped buttons with “${schema.labels[conflict]}”` : 'Button bindings saved');
  input.value = String(values.value[action]);
}
function actionFor(key: string) { return actions.find(action => schema.keys[values.value[action]] === key); }
function hotspotLabel(key: string) { const action = actionFor(key); return `${key} · ${action ? schema.contextLabel(action, layout.value) : '未分配'}`; }
function focusButton(key: string) {
  const action = actionFor(key); if (!action) return;
  const select = document.getElementById(`binding-${action}`) as HTMLSelectElement;
  const details = select.closest('details'); if (details) details.open = true;
  select.focus(); select.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try { select.showPicker?.(); } catch { /* Browser picker support varies. */ }
}
function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'local' && (changes.bindings || changes.bindingLayouts)) void reload();
}
onMounted(() => { chrome.storage.onChanged.addListener(changed); void reload(); });
onUnmounted(() => { disposed = true; chrome.storage.onChanged.removeListener(changed); });
</script>
<template>
  <div class="section-heading shortcut-heading"><div><h2 id="shortcutsTitle">Gamepad &amp; buttons</h2><p>Assign buttons to actions. Changes apply to YouTube tabs that are already open.</p></div><button id="resetBindings" type="button" class="secondary-button" :disabled="disabled" @click="save({ ...schema.defaults }, 'Default bindings restored')">Restore default bindings</button></div>
  <div class="binding-layout-tabs" role="group" aria-label="按键布局"><button v-for="id in (['watch', 'browse'] as const)" :key="id" type="button" :data-binding-layout="id" :aria-pressed="layout === id" :disabled="disabled" @click="layout = id">{{ schema.layouts[id] }}<span>{{ id === 'watch' ? '播放、进度与音量' : '浏览、选择与搜索' }}</span></button></div>
  <p class="binding-layout-hint" id="bindingLayoutHint">两套布局独立保存，进入对应页面时自动切换。点击手柄上的按键，修改对应功能。</p>
  <div class="controller-layout">
    <div id="bindingLeft" class="controller-side"><BindingRow v-for="action in left" :key="action" :action="action" :layout="layout" :value="values[action]" :disabled="disabled" @change="change" @focus="active = $event" @blur="active = undefined" /></div>
    <div class="controller-figure"><div id="controllerHotspots" class="controller-hotspots"><img class="controller-outline" :src="layoutImage" alt="手柄按键位置示意图" width="600" height="400"><button v-for="([x, y], key) in positionsOnPad" :key="key" type="button" class="controller-hotspot" :class="{ 'is-active': active && schema.keys[values[active]] === key }" :data-key="key" :style="{ left: `${x}%`, top: `${y}%` }" :disabled="disabled || !actionFor(key)" :aria-label="hotspotLabel(key)" :title="hotspotLabel(key)" @click="focusButton(key)">{{ key }}</button></div><p class="controller-caption" id="controllerCaption">{{ schema.layouts[layout] }}布局</p></div>
    <div id="bindingRight" class="controller-side"><BindingRow v-for="action in right" :key="action" :action="action" :layout="layout" :value="values[action]" :disabled="disabled" @change="change" @focus="active = $event" @blur="active = undefined" /></div>
    <div class="controller-navigation"><h3>左摇杆 · 十字键</h3><p>上下左右移动选择</p><span>导航方向固定</span></div>
    <div id="bindingBottom" class="controller-bottom"><BindingRow action="help" :layout="layout" :value="values.help" :disabled="disabled" @change="change" @focus="active = $event" @blur="active = undefined" /></div>
  </div>
  <details class="binding-search"><summary>搜索键盘快捷键</summary><div id="bindingFields" class="binding-grid"><BindingRow v-for="action in keyboard" :key="action" :action="action" :layout="layout" :value="values[action]" :disabled="disabled" @change="change" @focus="active = $event" @blur="active = undefined" /></div><p>搜索时，播放 / 暂停用于删除，后退 / 快进移动光标，音量键切换大小写 / 提交搜索。</p></details>
  <div class="binding-note"><strong>每个按键对应一个功能</strong><p>选择已使用的按键会交换两个功能，只影响当前布局。恢复默认也只影响当前布局。</p></div>
  <p class="shortcut-footnote">Button names show Xbox / PlayStation equivalents by physical position; Switch letters differ. Symbols and candidates shortcuts apply to the search keyboard. While searching, Play / pause deletes, Rewind / Forward moves the cursor, and Volume down / up changes letter case / submits the search.</p>
</template>
