<script setup lang="ts">
import { computed, ref } from 'vue';
import CommentThread from './CommentThread.vue';
import CommentTreeGuides from './CommentTreeGuides.vue';
import { useI18n } from '../shared/use-i18n';
import type { CommentReplySnapshot, ControllerStyle } from '../../types/ports';
const props = defineProps<{
  item: CommentReplySnapshot; items: readonly CommentReplySnapshot[]; rootKey: string;
  controllerStyle: ControllerStyle; depth?: number; ancestors?: readonly string[];
  loading?: boolean; replies: (key?: string) => void;
  translate?: (key: string) => void; like?: (key: string) => Promise<boolean>;
}>();
const { t } = useI18n();
const expanded = ref(false);
const path = computed(() => [...(props.ancestors || []), props.item.key]);
const children = computed(() => props.items.filter(item => item.parentId === props.item.key && !path.value.includes(item.key)));
const single = computed(() => children.value.length === 1 && !props.item.hasChildReplies);
const open = computed(() => single.value || expanded.value);
function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && !children.value.length && props.item.hasChildReplies) props.replies(props.item.key);
}
</script>

<template>
  <div class="detail-branch" :class="{ 'deep-branch': (depth || 0) >= 3 }">
    <span class="reply-threadline" aria-hidden="true"></span>
    <div class="detail-branch-content">
      <CommentThread class="comment" :item="item" :focus-key="`reply:${JSON.stringify([rootKey, item.key])}`"
        :translate="translate" :like="like" :controller-style="controllerStyle" />
      <div v-if="!single && (children.length || item.hasChildReplies)" class="reply-branch-actions">
        <button class="control reply-branch-toggle" :data-focus-id="`branch:${item.key}`" :aria-expanded="open"
          @click="toggle"><span class="reply-toggle-chevron" :class="{ expanded: open }" aria-hidden="true">›</span>{{ open ? t('Hide replies') : t('View replies') }}</button>
      </div>
      <div v-if="open" class="detail-replies nested-replies" :aria-label="t('Replies')">
        <CommentTreeGuides :revision="children" />
        <CommentBranch v-for="child in children" :key="child.key" :item="child" :items="items" :root-key="rootKey"
          :depth="(depth || 0) + 1" :ancestors="path" :replies="replies" :loading="loading"
          :translate="translate" :like="like" :controller-style="controllerStyle" />
      </div>
      <button v-if="open && item.hasChildReplies" class="control reply-branch-more"
        :data-focus-id="`branch-more:${item.key}`" :disabled="loading" @click="replies(item.key)">{{ t('Show more replies') }}</button>
    </div>
  </div>
</template>
