<script setup lang="ts">
import VideoGridSettings from './VideoGridSettings.vue';
import { onMounted, onBeforeUnmount } from 'vue';
import { createInlineSettingsModel, categories, physicalNames, positions, adjustments } from './inline-settings-model';
import CategorySettings from './CategorySettings.vue';

const props = defineProps<{ root: ShadowRoot; container: HTMLElement }>();
const model = createInlineSettingsModel(props.root, props.container);
const { state, schema } = model;
onMounted(model.start);
onBeforeUnmount(model.dispose);
</script>

<template>
  <div class="settings-layout">
    <nav class="settings-sidebar" aria-label="Settings categories">
      <span class="settings-brand">YouTube Gamepad</span>
      <button v-for="(label, key) in categories" :key="key" type="button" :data-setting="key"
        :disabled="state.saving || !state.values" :aria-current="state.category === key ? 'page' : undefined"
        @click="model.open(key)">
        <span class="settings-category-icon" aria-hidden="true">{{ { general: '⚙', display: '▣', controller: '✥', help: '?' }[key] }}</span>
        {{ label }}
      </button>
    </nav>
    <div class="settings-content">
  <p v-if="!state.values" role="status">{{ state.error || 'Loading settings…' }}</p>
  <template v-else-if="!state.category">
    <h3>Your gamepad, your way</h3>
    <p>Changes save automatically and apply to your open YouTube tabs.</p>
    <p>Choose a category to adjust your display, controller buttons and input sensitivity.</p>
  </template>
  <template v-else>
    <h3>{{ state.bindingAction ? schema.labels[state.bindingAction] : categories[state.category] }}</h3>
    <template v-if="state.category === 'general'">
      <button type="button" data-setting="enabled" :disabled="state.saving" :aria-pressed="state.values.enabled"
        @click="model.toggle('enabled')">Enable gamepad controls · {{ state.values.enabled ? 'On' : 'Off' }}</button>
      <p>Turning controls off closes this menu. Use the extension toolbar button to turn them on again.</p>
    </template>
    <template v-if="state.category === 'display'">
      <button type="button" data-setting="theater" :disabled="state.saving" :aria-pressed="state.values.theater"
        @click="model.toggle('theater')">TV layout · {{ state.values.theater ? 'On' : 'Off' }}</button>
      <button type="button" data-setting="autoFullscreen" :disabled="state.saving" :aria-pressed="!!state.values.autoFullscreen"
        @click="model.toggle('autoFullscreen')">Enter fullscreen when a gamepad is detected · {{ state.values.autoFullscreen ? 'On' : 'Off' }}</button>
      <p>TV layout and browser fullscreen work independently. Manual fullscreen stays under your control.</p>
      <CategorySettings />
      <VideoGridSettings :values="state.values" :disabled="state.saving" gamepad @save="(next, id) => model.saveGrid(next, id)" @reset="model.resetGrid" />
    </template>
    <template v-if="state.category === 'controller' && !state.bindingAction">
      <div class="inline-layout-tabs">
        <button v-for="layout in model.layouts" :key="layout.id" type="button" :data-setting="`layout-${layout.id}`"
          :disabled="state.saving" :aria-pressed="state.layout === layout.id" @click="model.selectLayout(layout.id)">{{ layout.label }}</button>
      </div>
      <p>两套布局独立保存，进入对应页面时自动切换。选择功能后修改按键，已使用的按键会交换功能。</p>
      <div class="inline-controller-map" role="group" :aria-label="`${schema.layouts[state.layout]}手柄布局`">
        <template v-for="([x, y], key) in positions" :key="key">
          <button v-if="model.actionFor(key)" class="inline-pad-key" type="button" :data-setting="`pad-${key}`"
            :style="{ left: `${x}%`, top: `${y}%` }" :disabled="state.saving"
            :aria-label="`${key} · ${schema.contextLabel(model.actionFor(key)!, state.layout)}`"
            :title="`${key} · ${schema.contextLabel(model.actionFor(key)!, state.layout)}`"
            @click="model.selectAction(model.actionFor(key)!)">{{ key }}</button>
        </template>
      </div>
      <button v-for="action in model.actions" :key="action" class="inline-binding-button" type="button"
        :data-setting="action" :disabled="state.saving" @click="model.selectAction(action)">
        <span aria-hidden="true" :data-ytg-family="state.family" :data-ytg-first-key="model.keyFor(action)"
          :data-ytg-second-key="model.keyFor(action)" data-ytg-icon="true" :data-inline-key="model.keyFor(action)">{{ model.keyFor(action) }}</span>
        {{ schema.contextLabel(action, state.layout) }} · {{ physicalNames[model.keyFor(action)] }}
      </button>
      <button type="button" data-setting="resetBindings" :disabled="state.saving" @click="model.reset">Restore default bindings</button>
      <h3>Input sensitivity</h3>
      <div v-for="item in adjustments" :key="item.key" class="inline-adjustment">
        <span>{{ item.label }} · {{ state.values[item.key] }}{{ item.suffix }}</span>
        <button type="button" :data-setting="`${item.key}-−`" :aria-label="`Decrease ${item.label}`"
          :disabled="state.saving || state.values[item.key] <= item.min" @click="model.adjust(item, -item.step, '−')">−</button>
        <button type="button" :data-setting="`${item.key}-+`" :aria-label="`Increase ${item.label}`"
          :disabled="state.saving || state.values[item.key] >= item.max" @click="model.adjust(item, item.step, '+')">+</button>
      </div>
    </template>
    <template v-else-if="state.category === 'controller'">
      <p>Names show Xbox / PlayStation equivalents by physical position; Switch letters differ.</p>
      <button v-for="(key, index) in schema.keys" :key="index" class="inline-binding-button" type="button"
        :data-setting="index" :disabled="state.saving" :aria-pressed="state.values.bindingLayouts[state.layout][state.bindingAction] === Number(index)"
        @click="model.bind(Number(index))">
        <span aria-hidden="true" :data-ytg-family="state.family" :data-ytg-first-key="key" :data-ytg-second-key="key"
          data-ytg-icon="true" :data-inline-key="key">{{ key }}</span>{{ physicalNames[key] }}
      </button>
    </template>
    <template v-if="state.category === 'help'">
      <p>Connect a standard-layout gamepad, click YouTube, then press a gamepad button. The D-pad and left stick navigate; the bottom button confirms.</p>
      <p>During search, Play / pause deletes, Rewind / Forward moves the cursor, and Volume down / up changes letter case / submits.</p>
      <button type="button" data-setting="exportDiagnostics" :disabled="state.saving" @click="model.exportDiagnostics">Export diagnostics JSON</button>
      <button type="button" data-setting="clearDiagnostics" :disabled="state.saving" @click="model.clearDiagnostics">Clear diagnostic records</button>
    </template>
    <button type="button" data-inline-back="true" :disabled="state.saving" @click="model.back">
      {{ state.bindingAction ? 'Back to gamepad settings' : 'Back to settings' }}
    </button>
  </template>
    </div>
  </div>
</template>
