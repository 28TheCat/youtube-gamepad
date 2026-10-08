<script setup lang="ts">
import { playbackIcons } from './playback-icons';
defineProps<{ name: string }>();
</script>
<template>
  <svg viewBox="0 0 24 24" aria-hidden="true"><component v-for="(shape, index) in playbackIcons[name] || []" :is="shape.tag" :key="index" :d="shape.tag === 'path' ? shape.value : undefined" :points="shape.tag === 'polygon' ? shape.value : undefined" /></svg>
</template>
