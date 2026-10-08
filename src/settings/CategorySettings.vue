<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { categorySettingsKey, categoryCatalogKey, defaultCategories, normalizeCategoryPreferences,
  normalizeCategoryCatalog, orderedCategories, type CategoryPreferences } from '../shared/browse-categories';
import css from './category-settings.css?inline';

const panel = ref<HTMLElement>();
const preferences = ref<CategoryPreferences>({ order: [], hidden: [] });
const catalog = ref(defaultCategories);
const ready = ref(false), saving = ref(false), message = ref('');
let disposed = false, revision = 0, dragged = '';
const items = computed(() => orderedCategories(catalog.value, preferences.value.order));
function applyCatalog(raw: unknown) {
  const merged = new Map(defaultCategories.map(item => [item.id, item]));
  for (const item of normalizeCategoryCatalog(raw)) merged.set(item.id, item);
  catalog.value = [...merged.values()];
}
async function save(next: CategoryPreferences, focusId?: string) {
  if (!ready.value || saving.value || disposed) return;
  // Chrome storage must receive plain arrays, not Vue's reactive proxies.
  const savedPreferences = normalizeCategoryPreferences(next);
  const active = panel.value?.getRootNode() as Document | ShadowRoot | undefined;
  const hadFocus = panel.value?.contains(active?.activeElement || null);
  saving.value = true;
  try {
    await chrome.storage.local.set({ [categorySettingsKey]: savedPreferences });
    if (disposed) return;
    preferences.value = savedPreferences;
    message.value = '已保存';
  } catch { if (!disposed) message.value = '保存失败，请重试。'; }
  finally {
    saving.value = false;
    await nextTick();
    if (!disposed && hadFocus && focusId) {
      const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      buttons.find(button => button.dataset.setting === focusId)?.focus({ preventScroll: true });
    }
  }
}
function toggle(id: string) {
  if (id === 'all') return;
  const hidden = new Set(preferences.value.hidden);
  if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
  void save({ ...preferences.value, hidden: [...hidden] }, `category-${id}`);
}
function move(id: string, offset: number) {
  const order = items.value.map(item => item.id), index = order.indexOf(id), target = index + offset;
  if (index < 0 || target < 0 || target >= order.length) return;
  order.splice(index, 1); order.splice(target, 0, id);
  void save({ ...preferences.value, order }, `category-${id}`);
}
function startDrag(event: DragEvent, id: string) {
  if (saving.value || !ready.value) { event.preventDefault(); return; }
  dragged = id;
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function drop(id: string) {
  const order = items.value.map(item => item.id);
  if (!dragged || dragged === id || !order.includes(dragged)) return;
  const source = dragged; dragged = '';
  order.splice(order.indexOf(source), 1); order.splice(order.indexOf(id), 0, source);
  void save({ ...preferences.value, order }, `category-${source}`);
}
function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local' || disposed) return;
  if (changes[categorySettingsKey]) { ++revision; preferences.value = normalizeCategoryPreferences(changes[categorySettingsKey].newValue); }
  if (changes[categoryCatalogKey]) { ++revision; applyCatalog(changes[categoryCatalogKey].newValue); }
}
onMounted(async () => {
  const style = document.createElement('style'); style.textContent = css; panel.value?.prepend(style);
  try {
    chrome.storage.onChanged.addListener(changed);
    const version = revision;
    const saved = await chrome.storage.local.get([categorySettingsKey, categoryCatalogKey]);
    if (disposed) return;
    if (version === revision) {
      preferences.value = normalizeCategoryPreferences(saved[categorySettingsKey]);
      applyCatalog(saved[categoryCatalogKey]);
    }
    ready.value = true;
  } catch { if (!disposed) message.value = '无法加载分类设置，请重新打开设置。'; }
});
onBeforeUnmount(() => { disposed = true; chrome.storage.onChanged.removeListener(changed); });
</script>
<template>
  <div ref="panel" class="category-settings">
    <div class="category-settings-heading"><h3>分类栏内容调整</h3>
      <button type="button" data-setting="category-reset" :disabled="!ready || saving"
        @click="save({ order: [], hidden: [] }, 'category-reset')">↺ 重置</button></div>
    <p>开关控制显示，拖动左侧手柄或使用上下按钮调整顺序。更改会自动保存。</p>
    <p class="category-settings-note">分类由 YouTube 提供，仅在当前页面可用时显示。“全部”始终保留；正在使用的分类切换后才会隐藏。重置恢复 YouTube 原有顺序。</p>
    <ol aria-label="分类显示与排序">
      <li v-for="(item, index) in items" :key="item.id" :data-category-id="item.id"
        :data-visible="!preferences.hidden.includes(item.id)" @dragover.prevent @drop.prevent="drop(item.id)">
        <span class="category-drag" :draggable="ready && !saving" title="拖动排序" aria-hidden="true"
          @dragstart="startDrag($event, item.id)" @dragend="dragged = ''">⠿</span>
        <span class="category-label">{{ item.label }}</span>
        <div class="category-actions">
          <button type="button" :data-setting="`category-up-${item.id}`" :aria-label="`上移${item.label}`"
            :disabled="!ready || saving || index === 0" @click="move(item.id, -1)">↑</button>
          <button type="button" :data-setting="`category-down-${item.id}`" :aria-label="`下移${item.label}`"
            :disabled="!ready || saving || index === items.length - 1" @click="move(item.id, 1)">↓</button>
          <button type="button" class="category-toggle" role="switch" :data-setting="`category-${item.id}`"
            :aria-label="`显示${item.label}`" :aria-checked="!preferences.hidden.includes(item.id)"
            :disabled="!ready || saving || item.id === 'all'" @click="toggle(item.id)">
            <span>{{ preferences.hidden.includes(item.id) ? '隐藏' : '显示' }}</span><span class="category-switch" aria-hidden="true"></span>
          </button>
        </div>
      </li>
    </ol>
    <p role="status" aria-live="polite">{{ message }}</p>
  </div>
</template>
