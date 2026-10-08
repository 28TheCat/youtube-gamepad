<script setup lang="ts">
import { useInteractionStore } from '../app/interaction-store';

defineProps<{ items: readonly (readonly [string, string])[] }>();
const emit = defineEmits<{ action: [id: string, button: HTMLButtonElement] }>();
const store = useInteractionStore();
</script>

<template>
  <section v-if="store.state.menu.opened && store.state.menu.view === 'main'"
    role="dialog" aria-modal="true" aria-label="Quick menu" data-vue-quick-menu>
    <h2>Quick menu</h2>
    <div id="items">
      <button v-for="[id, label] in items" :key="id" :data-menu-action="id"
        @click="emit('action', id, $event.currentTarget as HTMLButtonElement)">{{ label }}</button>
    </div>
    <p id="message" role="status"></p>
    <p id="shortcuts" class="controls"></p>
  </section>
</template>
