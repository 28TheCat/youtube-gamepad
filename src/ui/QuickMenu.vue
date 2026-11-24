<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { useInteractionStore } from '../app/interaction-store';
import { ui } from './ui-api';
import { computed } from 'vue';

defineProps<{ items: readonly (readonly [string, string])[] }>();
const emit = defineEmits<{ action: [id: string, button: HTMLButtonElement] }>();
const store = useInteractionStore();
const browse = computed(() => ui.state.browse);
const watchActions = computed(() => ui.state.watchActions);
</script>

<template>
  <section v-if="store.state.menu.opened && store.state.menu.view === 'main'"
    role="dialog" aria-modal="true" :aria-label="t('Quick menu')" data-vue-quick-menu>
    <h2>{{ t("Quick menu") }}</h2>
    <div id="items">
      <template v-for="[id, label] in items" :key="id">
        <button v-if="id !== 'refreshHome' || browse?.home && browse.mode === 'gamepad'" :data-menu-action="id"
          :data-ytg-page-mode="id === 'pageMode' ? '' : undefined" :role="id === 'pageMode' ? 'switch' : undefined"
          :aria-checked="id === 'pageMode' ? browse?.mode === 'gamepad' : undefined"
          :aria-pressed="id.startsWith('watch:') ? watchActions.find(item => `watch:${item.id}` === id)?.pressed : undefined"
          :disabled="id === 'pageMode' ? browse?.busy : id === 'refreshHome' ? !browse?.canRefreshHome : false"
          @click="emit('action', id, $event.currentTarget as HTMLButtonElement)">{{ t(id === 'pageMode' ? (browse?.mode === 'youtube' ? 'Switch to Gamepad' : 'Switch to YouTube') : label) }}</button>
      </template>
    </div>
    <p id="message" role="status"></p>
    <p id="shortcuts" class="controls"></p>
  </section>
</template>
