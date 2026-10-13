<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { ref } from 'vue';
import { gridBreakpoints, type VideoGridSettings, type VideoGridKey } from '../shared/video-grid';
import css from './video-grid-settings.css?inline';
const props = defineProps<{ values: VideoGridSettings; disabled: boolean; gamepad?: boolean }>();
const emit = defineEmits<{ save: [next: Partial<VideoGridSettings>, id: string]; reset: [] }>();
const preview = ref<Partial<VideoGridSettings>>({});
function change(key: VideoGridKey, event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity()) { input.reportValidity(); input.value = String(props.values[key]); return; }
  preview.value = {};
  emit('save', { [key]: input.type === 'checkbox' ? input.checked : Number(input.value) }, key);
}
function adjust(key: Exclude<VideoGridKey, 'gridAutoSwitch' | 'gridLayout'>, delta: number, min: number, max: number) {
  emit('save', { [key]: Math.max(min, Math.min(max, props.values[key] + delta)) }, `${key}-${delta > 0 ? 'plus' : 'minus'}`);
}
</script>
<template>
  <component :is="'style'">{{ css }}</component>
  <div class="video-grid-settings">
    <h4>{{ t("视频卡片网格") }}</h4>
    <p>{{ t("设置不同视频卡片区域宽度下显示的列数。当区域宽度大于等于设定值时，使用对应的列数。") }}</p>
    <div class="video-grid-modes" role="group" :aria-label="t('视频卡片布局')">
      <button v-for="mode in [{ key: 'adaptive' as const, label: t('自适应网格') }, { key: 'oneColumn' as const, label: t('单列列表') }, { key: 'twoColumns' as const, label: t('双列列表') }]" :key="mode.key" type="button" :data-setting="`gridLayout-${mode.key}`" :aria-pressed="values.gridLayout === mode.key" :disabled="disabled" @click="emit('save', { gridLayout: mode.key }, `gridLayout-${mode.key}`)">{{ t(mode.label) }}</button>
    </div>
    <div class="video-grid-panel">
      <div class="grid-setting-row">
        <div><label for="gridAutoSwitch">{{ t("根据视频卡片区域宽度自动切换单双列") }}</label><p>{{ t("开启后，双列模式会在视频卡片区域宽度小于设定宽度时自动切换为单列。") }}</p></div>
        <div class="grid-controls">
          <label class="grid-number">{{ t("切换宽度") }} <input id="gridSwitchWidth" type="number" min="320" max="1200" step="1" required :disabled="disabled" :value="values.gridSwitchWidth" @change="change('gridSwitchWidth', $event)"> px</label>
          <button v-if="gamepad" id="gridAutoSwitch" type="button" data-setting="gridAutoSwitch" class="grid-toggle" role="switch" :aria-checked="values.gridAutoSwitch" :aria-label="t('自动切换单双列')" :disabled="disabled" @click="emit('save', { gridAutoSwitch: !values.gridAutoSwitch }, 'gridAutoSwitch')"></button>
          <input v-else id="gridAutoSwitch" class="grid-toggle" type="checkbox" :aria-label="t('自动切换单双列')" :checked="values.gridAutoSwitch" :disabled="disabled" @change="change('gridAutoSwitch', $event)">
          <template v-if="gamepad"><button v-for="delta in [-32, 32]" :key="delta" type="button" :data-setting="`gridSwitchWidth-${delta > 0 ? 'plus' : 'minus'}`" :disabled="disabled" :aria-label="delta > 0 ? t('增加切换宽度') : t('减少切换宽度')" @click="adjust('gridSwitchWidth', delta, 320, 1200)">{{ delta > 0 ? '+' : '−' }}</button></template>
        </div>
      </div>
      <div class="grid-setting-row">
        <div><h5>{{ t("封面占比") }}</h5><p>{{ t("分别设置单列与双列横向视频卡片中封面所占的宽度。") }}</p></div>
        <div class="grid-cover-controls">
          <div v-for="item in [{ key: 'gridSingleCover' as const, label: t('单列布局') }, { key: 'gridDoubleCover' as const, label: t('双列布局') }]" :key="item.key" class="grid-cover">
            <label :for="item.key">{{ t(item.label) }}</label>
            <input :id="item.key" type="range" min="30" max="70" step="5" :disabled="disabled" :value="values[item.key]" @input="preview[item.key] = Number(($event.target as HTMLInputElement).value)" @change="change(item.key, $event)">
            <output :for="item.key">{{ preview[item.key] ?? values[item.key] }}%</output>
            <template v-if="gamepad"><button v-for="delta in [-5, 5]" :key="delta" type="button" :data-setting="`${item.key}-${delta > 0 ? 'plus' : 'minus'}`" :disabled="disabled" :aria-label="t('{direction} {label} thumbnail width', { direction: t(delta > 0 ? 'Increase' : 'Decrease'), label: item.label })" @click="adjust(item.key, delta, 30, 70)">{{ delta > 0 ? '+' : '−' }}</button></template>
          </div>
        </div>
      </div>
      <div class="grid-breakpoints">
        <h5>{{ t("网格断点配置") }}</h5><p>{{ t("按视频卡片区域的实际宽度应用列数，侧栏占用的空间不计入。") }}</p>
        <div class="grid-breakpoint-fields">
          <div v-for="item in gridBreakpoints" :key="item.key" class="grid-breakpoint">
            <label :for="item.key">{{ t(item.label) }}</label><input :id="item.key" type="number" min="1" max="12" step="1" required :disabled="disabled" :value="values[item.key]" @change="change(item.key, $event)"><span>{{ t("列") }}</span>
            <template v-if="gamepad"><button v-for="delta in [-1, 1]" :key="delta" type="button" :data-setting="`${item.key}-${delta > 0 ? 'plus' : 'minus'}`" :disabled="disabled" :aria-label="t('{label}: {direction} column count', { label: item.label, direction: t(delta > 0 ? 'Increase' : 'Decrease') })" @click="adjust(item.key, delta, 1, 12)">{{ delta > 0 ? '+' : '−' }}</button></template>
          </div>
        </div>
      </div>
      <button type="button" data-setting="resetVideoGrid" :disabled="disabled" @click="emit('reset')">{{ t("重置") }}</button>
    </div>
  </div>
</template>
