<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { CommentSnapshot, CommentReplySnapshot } from '../../types/ports';
const props = defineProps<{
  item: CommentSnapshot | CommentReplySnapshot;
  openThread?: (key: string) => void;
  focusKey?: string;
}>();
const { t } = useI18n();
const failedAvatar = ref('');
const key = computed(() => props.focusKey || props.item.key);
const canOpen = computed(() => !!props.openThread && 'replies' in props.item && (props.item.hasReplies || props.item.replies.length > 0));
const replyLabel = computed(() => 'replyCount' in props.item && props.item.replyCount
  ? t('View {count} replies', { count: props.item.replyCount }) : t('View replies'));
</script>

<template>
  <article class="comment-thread" :class="{ 'comment-reply': focusKey }">
    <component :is="canOpen ? 'button' : 'div'" class="comment-header" :data-focus-id="`comment:${key}`"
      :tabindex="canOpen ? undefined : 0" @click="canOpen && openThread?.(item.key)">
      <span class="comment-avatar" aria-hidden="true">
        <img v-if="item.avatar && failedAvatar !== item.avatar" :key="item.avatar" :src="item.avatar" alt=""
          loading="lazy" referrerpolicy="no-referrer" @error="failedAvatar = item.avatar || ''" />
        <template v-else>{{ Array.from(item.author.trim())[0] || '·' }}</template>
      </span>
      <span class="comment-author">{{ item.author || t('Reply') }}</span>
    </component>
    <div class="comment-body"><p class="comment-text">{{ item.text }}</p></div>
    <button v-if="canOpen" class="comment-replies" :data-focus-id="`replies:${item.key}`" @click="openThread?.(item.key)">
      <span class="comment-replies-label">{{ replyLabel }}</span>
      <span class="comment-replies-chevron" aria-hidden="true"></span>
    </button>
  </article>
</template>
