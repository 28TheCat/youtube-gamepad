<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ src?: string; name?: string; size?: number | string; lazy?: boolean }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
const initial = computed(() => Array.from((props.name || '').trim())[0] || '●');
const dimensions = computed(() => {
  const size = typeof props.size === 'number' ? `${props.size}px` : props.size;
  return { width: size, height: size };
});
</script>
<template>
  <span class="channel-avatar" aria-hidden="true" :style="dimensions"
    style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:50%;overflow:hidden">
    <img v-if="src && !failed" :key="src" data-view="avatarImage" :src="src" alt=""
      :loading="lazy === false ? 'eager' : 'lazy'" decoding="async" referrerpolicy="no-referrer"
      style="display:block;width:100%;height:100%;object-fit:cover;border-radius:50%" @error="failed = true" />
    <span v-else data-view="avatarFallback">{{ initial }}</span>
  </span>
</template>
