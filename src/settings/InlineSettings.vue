<script setup lang="ts">
import InterfaceIcon from '../ui/InterfaceIcon.vue';
import LoadStatus from '../ui/LoadStatus.vue';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import VideoGridSettings from './VideoGridSettings.vue';
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { createInlineSettingsModel, categories, physicalNames, positions, adjustments } from './inline-settings-model';
import CategorySettings from './CategorySettings.vue';
import ControllerBindingOverview from './ControllerBindingOverview.vue';

const props = defineProps<{ root: ShadowRoot; container: HTMLElement }>();
const model = createInlineSettingsModel(props.root, props.container);
const { state, schema } = model;
const actionListOpen = ref(false);
onMounted(model.start);
onBeforeUnmount(model.dispose);
</script>

<template>
  <div class="settings-layout" :lang="state.values?.uiLanguage">
    <nav class="settings-sidebar" :aria-label="t('Settings categories')">
      <span class="settings-brand">YouTube Gamepad</span>
      <button v-for="(label, key) in categories" :key="key" type="button" :data-setting="key"
        :disabled="state.saving || !state.values" :aria-current="state.category === key ? 'page' : undefined"
        @click="model.open(key)">
        <InterfaceIcon class="settings-category-icon" :name="{ general: 'settings', display: 'layout', controller: 'gamepad', help: 'help' }[key]" :filled="state.category === key" />
        {{ t(label) }}
      </button>
    </nav>
    <div class="settings-content">
  <LoadStatus v-if="!state.values" :loading="!state.error" :failed="!!state.error" error-role="status"
    :loading-message="t('Loading settings…')" :error-message="t(state.error)" />
  <template v-else-if="!state.category">
    <h3>{{ t("Your gamepad, your way") }}</h3>
    <p>{{ t("Changes save automatically and apply to your open YouTube tabs.") }}</p>
    <p>{{ t("Choose a category to adjust your display, controller buttons and input sensitivity.") }}</p>
  </template>
  <template v-else>
    <h3>{{ state.bindingKey ? t(physicalNames[state.bindingKey]) : t(state.bindingAction ? schema.labels[state.bindingAction] : categories[state.category]) }}</h3>
    <template v-if="state.category === 'general'">
      <h4>{{ t('Interface language') }}</h4>
      <div class="inline-layout-tabs" role="group" :aria-label="t('Interface language')">
        <button v-for="language in [{ id: 'en' as const, label: 'English' }, { id: 'zh-CN' as const, label: '简体中文' }]"
          :key="language.id" type="button" :data-setting="`language-${language.id}`" :disabled="state.saving"
          :aria-pressed="state.values.uiLanguage === language.id" @click="model.setLanguage(language.id)">{{ language.label }}</button>
      </div>
      <p>{{ t('Language changes apply immediately and save automatically.') }}</p>
      <button type="button" data-setting="enabled" :disabled="state.saving" :aria-pressed="state.values.enabled"
        @click="model.toggle('enabled')">{{ t("Enable gamepad controls ·") }} {{ state.values.enabled ? t('On') : t('Off') }}</button>
      <p>{{ t("Turning controls off closes this menu. Use the extension toolbar button to turn them on again.") }}</p>
    </template>
    <template v-if="state.category === 'display'">
      <button type="button" data-setting="theater" :disabled="state.saving" :aria-pressed="state.values.theater"
        @click="model.toggle('theater')">{{ t("TV layout ·") }} {{ state.values.theater ? t('On') : t('Off') }}</button>
      <button type="button" data-setting="autoFullscreen" :disabled="state.saving" :aria-pressed="!!state.values.autoFullscreen"
        @click="model.toggle('autoFullscreen')">{{ t("Enter fullscreen when a gamepad is detected ·") }} {{ state.values.autoFullscreen ? t('On') : t('Off') }}</button>
      <p>{{ t("TV layout and browser fullscreen work independently. Manual fullscreen stays under your control.") }}</p>
      <h4>{{ t('Default playback layout') }}</h4>
      <div class="inline-layout-tabs playback-layout-options" role="group" :aria-label="t('Default playback layout')">
        <button v-for="layout in [{ id: 'fullscreen' as const, label: 'Fullscreen gamepad' }, { id: 'windowed' as const, label: 'Windowed gamepad' }]"
          :key="layout.id" type="button" :data-setting="`playback-${layout.id}`" :disabled="state.saving"
          :aria-pressed="state.values.playbackLayout === layout.id" @click="model.setPlaybackLayout(layout.id)">{{ t(layout.label) }}</button>
      </div>
      <p>{{ t('Choose the gamepad playback layout. Mouse and keyboard use the windowed gamepad interface. Browser fullscreen is separate.') }}</p>
      <CategorySettings />
      <VideoGridSettings :values="state.values" :disabled="state.saving" gamepad @save="(next, id) => model.saveGrid(next, id)" @reset="model.resetGrid" />
    </template>
    <template v-if="state.category === 'controller' && !state.bindingAction && !state.bindingKey">
      <button type="button" data-setting="rightHandMode" :disabled="state.saving" :aria-pressed="state.values.rightHandMode" @click="model.toggle('rightHandMode')">{{ t('Right-hand preset') }} · {{ t(state.values.rightHandMode ? 'On' : 'Off') }}</button>
      <p>{{ t('Right stick navigates. A confirms, B goes back, X plays or pauses, Y searches, RB opens the menu. Turn off to restore your custom bindings.') }}</p>
      <div class="inline-layout-tabs">
        <button v-for="layout in model.layouts" :key="layout.id" type="button" :data-setting="`layout-${layout.id}`"
          :disabled="state.saving" :aria-pressed="state.layout === layout.id" @click="model.selectLayout(layout.id)">{{ t(layout.label) }}</button>
      </div>
      <p>{{ t("两套布局独立保存，进入对应页面时自动切换。点击手柄上的按键，修改对应功能。") }}</p>
      <ControllerBindingOverview :family="state.family" :layout="schema.layouts[state.layout]"
        :summaries="Object.fromEntries(Object.keys(positions).map(key => [key, model.summaryFor(key)]))"
        :disabled="state.saving || state.values.rightHandMode" @select="model.selectButton" />
      <details class="inline-action-list" :open="actionListOpen">
      <summary><button type="button" data-setting="action-list" @click.prevent="actionListOpen = !actionListOpen">{{ t('Edit bindings by action') }}</button></summary>
      <button v-for="action in model.actions" :key="action" class="inline-binding-button" type="button"
        :data-setting="action" :disabled="state.saving || state.values.rightHandMode" @click="model.selectAction(action)">
        <span aria-hidden="true" :data-ytg-family="state.family" :data-ytg-first-key="model.keyFor(action)"
          :data-ytg-second-key="model.keyFor(action)" data-ytg-icon="true" :data-inline-key="model.keyFor(action)">{{ model.keyFor(action) }}</span>
        {{ t(schema.contextLabel(action, state.layout)) }} · {{ t(physicalNames[model.keyFor(action)]) }}
      </button>
      </details>
      <button type="button" data-setting="resetBindings" :disabled="state.saving || state.values.rightHandMode" @click="model.reset">{{ t("Restore default bindings") }}</button>
      <h3>{{ t("Input sensitivity") }}</h3>
      <div v-for="item in adjustments" :key="item.key" class="inline-adjustment">
        <span>{{ t(item.label) }} · {{ state.values[item.key] }}{{ item.suffix }}</span>
        <button type="button" :data-setting="`${item.key}-−`" :aria-label="t('Decrease {label}', { label: t(item.label) })"
          :disabled="state.saving || state.values[item.key] <= item.min" @click="model.adjust(item, -item.step, '−')">−</button>
        <button type="button" :data-setting="`${item.key}-+`" :aria-label="t('Increase {label}', { label: t(item.label) })"
          :disabled="state.saving || state.values[item.key] >= item.max" @click="model.adjust(item, item.step, '+')">+</button>
      </div>
    </template>
    <template v-else-if="state.category === 'controller' && state.bindingKey">
      <p>{{ t('选择此按键要执行的功能。已使用的功能会交换绑定，修改自动保存。') }}</p>
      <label for="inline-shortcut-recorder">{{ t('Record a page shortcut') }}</label>
      <input id="inline-shortcut-recorder" data-shortcut-recorder data-setting="shortcut-recorder" readonly
        :disabled="state.saving" :value="model.shortcutFor(state.bindingKey) ? schema.shortcutLabel(model.shortcutFor(state.bindingKey)) : ''"
        :placeholder="t('Click here, then press a key')" @keydown="model.recordShortcut">
      <p>{{ t('Page shortcuts: Enter, Esc, Space, /, F1, PageUp, PageDown, arrows, −, =, J, K, L, M, C. Browser and Windows shortcuts are unavailable.') }}</p>
      <p v-if="state.shortcutError" role="alert">{{ t(state.shortcutError) }}</p>
      <button v-for="action in model.actions" :key="action" class="inline-binding-button" type="button"
        :data-setting="`assign-${action}`" :disabled="state.saving"
        :aria-pressed="!model.shortcutFor(state.bindingKey) && model.keyFor(action) === state.bindingKey" @click="model.assignAction(action)">
        <span aria-hidden="true" :data-ytg-family="state.family" :data-ytg-first-key="model.keyFor(action)"
          :data-ytg-second-key="model.keyFor(action)" data-ytg-icon="true" :data-inline-key="model.keyFor(action)">{{ model.keyFor(action) }}</span>
        {{ t(schema.contextLabel(action, state.layout)) }}
      </button>
    </template>
    <template v-else-if="state.category === 'controller'">
      <p>{{ t("Names show Xbox / PlayStation equivalents by physical position; Switch letters differ.") }}</p>
      <button v-for="(key, index) in schema.keys" :key="index" class="inline-binding-button" type="button"
        :data-setting="index" :disabled="state.saving" :aria-pressed="state.values.bindingLayouts[state.layout][state.bindingAction] === Number(index)"
        @click="model.bind(Number(index))">
        <span aria-hidden="true" :data-ytg-family="state.family" :data-ytg-first-key="key" :data-ytg-second-key="key"
          data-ytg-icon="true" :data-inline-key="key">{{ key }}</span>{{ t(physicalNames[key]) }}
      </button>
    </template>
    <template v-if="state.category === 'help'">
      <p>{{ t("Connect a standard-layout gamepad, click YouTube, then press a gamepad button. The D-pad and left stick navigate; the bottom button confirms.") }}</p>
      <p>{{ t("During search, Play / pause deletes, Rewind / Forward moves the cursor, and Volume down / up changes letter case / submits.") }}</p>
      <button type="button" data-setting="exportDiagnostics" :disabled="state.saving" @click="model.exportDiagnostics">{{ t("Export diagnostics JSON") }}</button>
      <button type="button" data-setting="clearDiagnostics" :disabled="state.saving" @click="model.clearDiagnostics">{{ t("Clear diagnostic records") }}</button>
    </template>
    <button type="button" data-inline-back="true" :disabled="state.saving" @click="model.back">
      {{ state.bindingAction || state.bindingKey ? t('Back to gamepad settings') : t('Back to settings') }}
    </button>
  </template>
    </div>
  </div>
</template>
