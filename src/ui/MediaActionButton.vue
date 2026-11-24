<script setup lang="ts">
import { computed } from 'vue';
import InterfaceIcon from './InterfaceIcon.vue';
import { useI18n } from '../shared/use-i18n';
const props = defineProps<{ action: 'like' | 'comments' | 'save' | 'mute'; active?: boolean; disabled?: boolean; showLabel?: boolean; likeCount?: number; commentCount?: string }>();
const emit = defineEmits<{ activate: [] }>();
const { t, language } = useI18n();
const labels = { like: 'Like', comments: 'Comments', save: 'Save to playlist', mute: 'Mute / unmute' };
const icon = computed(() => props.action === 'mute' ? (props.active ? 'muted' : 'volume') : props.action);
const count = computed(() => props.likeCount === undefined ? '' :
  new Intl.NumberFormat(language.value, { notation: 'compact', maximumFractionDigits: 1 }).format(props.likeCount));
const label = computed(() => props.action === 'comments' && props.commentCount ? `${t('Comments')} ${props.commentCount}` : count.value ? `${t(labels[props.action])} · ${props.likeCount?.toLocaleString(language.value)}` : t(labels[props.action]));
</script>
<template>
  <button type="button" class="control media-action" :class="{ 'has-like-count': count }" :data-media-action="action" :aria-label="label" :title="label"
    :aria-pressed="active" :disabled="disabled" @click="emit('activate')"><InterfaceIcon :name="icon" :filled="action === 'like' && active" /><span v-if="count">{{ count }}</span><span v-else-if="showLabel">{{ t(labels[action]) }}{{ action === 'comments' && commentCount ? ' ' + commentCount : '' }}</span></button>
</template>
