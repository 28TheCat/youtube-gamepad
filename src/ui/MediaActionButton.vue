<script setup lang="ts">
import { computed } from 'vue';
import InterfaceIcon from './InterfaceIcon.vue';
import { useI18n } from '../shared/use-i18n';
const props = defineProps<{ action: 'like' | 'comments' | 'save' | 'mute'; active?: boolean; disabled?: boolean; showLabel?: boolean }>();
const emit = defineEmits<{ activate: [] }>();
const { t } = useI18n();
const labels = { like: 'Like', comments: 'Comments', save: 'Save to playlist', mute: 'Mute / unmute' };
const icon = computed(() => props.action === 'mute' ? (props.active ? 'muted' : 'volume') : props.action);
</script>
<template>
  <button type="button" class="control media-action" :data-media-action="action" :aria-label="t(labels[action])" :title="t(labels[action])"
    :aria-pressed="active" :disabled="disabled" @click="emit('activate')"><InterfaceIcon :name="icon" :filled="action === 'like' && active" /><span v-if="showLabel">{{ t(labels[action]) }}</span></button>
</template>
