<script setup lang="ts">
defineProps<{ open: () => void }>();
</script>

<template>
  <button type="button" aria-label="Open YouTube Gamepad settings" title="YouTube Gamepad settings" @click="open">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m9.5 3-.7 2.2-2 .9-2.1-.5-2 3.4 1.5 1.7v2.6L2.7 15l2 3.4 2.1-.5 2 .9.7 2.2h4l.7-2.2 2-.9 2.1.5 2-3.4-1.5-1.7v-2.6L20.3 9l-2-3.4-2.1.5-2-.9L13.5 3z" />
      <circle cx="11.5" cy="12" r="3.2" />
    </svg>
  </button>
</template>
