<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import CommentThread from './CommentThread.vue';
import CommentSkeleton from './CommentSkeleton.vue';
import CommentActions from './CommentActions.vue';
import SubscriptionOptions from './SubscriptionOptions.vue';
import { ref, computed } from 'vue';
import CommentBranch from './CommentBranch.vue';
import CommentTreeGuides from './CommentTreeGuides.vue';
const commentActions = ref<InstanceType<typeof CommentActions>>();
const reply = (key: string) => commentActions.value?.reply(key);
import LoadStatus from './LoadStatus.vue';
const { t } = useI18n();
function opensNewTab(href: string) {
  try { const url = new URL(href, 'https://www.youtube.com'); return url.hostname !== 'www.youtube.com' || url.pathname === '/redirect'; }
  catch { return false; }
}
import type { Directive } from 'vue';
import type { CommentSnapshot, CommentsStatus, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';
const props = defineProps<{
  panel: 'description' | 'comments' | 'playlists' | 'subscription'; text: string; descriptionRuns?: readonly import('../../types/core').DescriptionRun[]; records: readonly CommentSnapshot[];
  unavailable: boolean; controllerStyle: ControllerStyle; thread?: CommentSnapshot; replyLimit?: number;
  openThread: (key: string) => void; replies: (key?: string) => void; load: () => void;
  translate?: (key: string) => void;
  commentsStatus?: CommentsStatus; commentRoute?: string;
  likeComment?: (key: string) => Promise<boolean>;
  postComment?: (text: string, key?: string) => Promise<boolean>;
  sortComments?: (sort: 'TOP_COMMENTS' | 'NEWEST_FIRST') => boolean;
  notificationPreference?: import('../../types/ports').NotificationPreference; subscriptionLoading?: boolean; subscriptionFailed?: boolean;
  subscriptionAction?: (action: import('../../types/ports').WatchAction) => void;
  playlists?: readonly SavedPlaylistSnapshot[]; playlistLoading?: boolean; playlistFailed?: boolean;
  savePlaylist?: (key: string) => void; retryPlaylists?: () => void;
}>();
const rootReplies = computed(() => {
  const items = props.thread?.replies || [];
  const keys = new Set(items.map(item => item.key));
  return items.filter(item => !item.parentId || item.parentId === props.thread?.key || !keys.has(item.parentId));
});
const vHint: Directive<HTMLElement, [ControllerStyle, string]> = {
  mounted(el, binding) { binding.value[0].hint(el, binding.value[1]); },
  updated(el, binding) {
    if (binding.value[1] !== binding.oldValue?.[1]) binding.value[0].hint(el, binding.value[1]);
  }
};
</script>

<template>
  <CommentActions v-if="panel === 'comments'" ref="commentActions" :records="records" :status="commentsStatus" :route="commentRoute || ''"
    :post="postComment" :change-sort="sortComments" :thread="!!thread" :comment-count="commentsStatus?.commentCount" />
  <div v-if="panel === 'description'" data-vue-description><template v-for="(part, index) in descriptionRuns?.length ? descriptionRuns : [{ text: text || t('No description available'), href: undefined }]" :key="index"><a v-if="part.href" :href="part.href" :target="opensNewTab(part.href) ? '_blank' : undefined" :rel="opensNewTab(part.href) ? 'noopener noreferrer' : undefined" :data-focus-id="`description:link:${index}`">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></div>
  <SubscriptionOptions v-else-if="panel === 'subscription'" :preference="notificationPreference"
    :loading="subscriptionLoading" :failed="subscriptionFailed" @action="subscriptionAction?.($event)" />
  <div v-else-if="panel === 'playlists'" data-vue-playlists>
    <LoadStatus :loading="playlistLoading" :failed="playlistFailed" :empty="!playlists?.length" error-role="status"
      :loading-message="t('Loading…')" :error-message="t('Could not update playlists. Try again.')"
      :empty-message="t('No editable playlists. Sign in to save videos.')"
      retryable :retry-attributes="{ class: 'control', 'data-focus-id': 'playlists:retry' }" @retry="retryPlaylists?.()" />
    <button v-for="item in playlists" :key="item.key" class="control playlist-option"
      :data-focus-id="`playlist:${item.key}`" :aria-pressed="item.selected" :disabled="playlistLoading"
      @click="savePlaylist?.(item.key)">{{ item.selected ? '✓ ' : '+ ' }}{{ item.title }}</button>
  </div>
  <div v-else-if="thread" data-vue-comments data-comment-detail>
    <CommentThread :key="thread.key" class="comment detail-parent" :item="thread" :reply="reply" :translate="translate" :like="likeComment" :controller-style="controllerStyle" />
    <div class="detail-children">
      <p class="detail-reply-count">{{ thread.replyCount ? t(thread.replyCount === 1 ? '1 reply' : '{count} replies', { count: thread.replyCount }) : t('Replies') }}</p>
      <div class="detail-replies" :aria-label="t('Replies')">
        <CommentTreeGuides :revision="rootReplies.slice(0, replyLimit)" />
        <CommentBranch v-for="item in rootReplies.slice(0, replyLimit)" :key="`${thread.key}:${item.key}`"
          :item="item" :items="thread.replies" :root-key="thread.key" :replies="replies"
          :loading="commentsStatus?.loading" :translate="translate" :like="likeComment" :controller-style="controllerStyle" />
      </div>
    </div>
    <CommentSkeleton v-if="commentsStatus?.loading" replies />
    <LoadStatus :class="{ 'comment-loading-status': commentsStatus?.loading }" :loading="commentsStatus?.loading" :failed="commentsStatus?.failed"
      :empty="rootReplies.length <= (replyLimit || 0) && !thread.hasReplies" error-role="status"
      :loading-message="t('Loading replies…')" :error-message="t('Could not load replies. Try again.')" :empty-message="t('No more replies.')"
      retryable :retry-attributes="{ class: 'control', 'data-focus-id': 'replies:more' }" @retry="replies()" />
    <button v-if="!commentsStatus?.failed && (rootReplies.length > (replyLimit || 0) || thread.hasReplies)"
      class="control" data-focus-id="replies:more" :disabled="commentsStatus?.loading" @click="replies()">{{ t('Show more replies') }}</button>
  </div>
  <div v-else data-vue-comments>
    <CommentThread v-for="item in records" :key="item.key" class="comment" :item="item"
      :open-thread="openThread" :reply="reply" :translate="translate" :like="likeComment" :controller-style="controllerStyle" />
    <CommentSkeleton v-if="commentsStatus?.loading" />
    <LoadStatus :class="{ 'comment-loading-status': commentsStatus?.loading }" :loading="commentsStatus?.loading" :failed="commentsStatus?.failed"
      :empty="!records.length || !!commentsStatus && !commentsStatus.hasMore" error-role="status"
      :loading-message="t('Loading comments…')" :error-message="t('Could not load comments. Retry to continue.')"
      retryable :retry-attributes="{ class: 'control', 'data-focus-id': 'comments:more' }" @retry="load">
      <template #empty>
        <template v-if="commentsStatus && !commentsStatus.hasMore">{{ t('No more comments.') }}</template>
        <span v-else v-hint="[controllerStyle, unavailable
          ? t('Comments are unavailable. Playback continues normally. B Back.')
          : t('Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.')]"></span>
      </template>
    </LoadStatus>
    <button v-if="!commentsStatus?.failed && records.length && (!commentsStatus || commentsStatus.hasMore)"
      class="control" data-focus-id="comments:more" :disabled="commentsStatus?.loading" @click="load">{{ t('Load more comments') }}</button>
  </div>
</template>
