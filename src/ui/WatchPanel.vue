<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import CommentThread from './CommentThread.vue';
const { t } = useI18n();
import type { Directive } from 'vue';
import type { CommentSnapshot, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';
defineProps<{
  panel: 'description' | 'comments' | 'playlists'; text: string; records: readonly CommentSnapshot[];
  unavailable: boolean; controllerStyle: ControllerStyle; thread?: CommentSnapshot; replyLimit?: number;
  openThread: (key: string) => void; replies: () => void; load: () => void;
  commentsStatus?: { loading: boolean; failed: boolean; hasMore: boolean };
  playlists?: readonly SavedPlaylistSnapshot[]; playlistLoading?: boolean; playlistFailed?: boolean;
  savePlaylist?: (key: string) => void; retryPlaylists?: () => void;
}>();
const vHint: Directive<HTMLElement, [ControllerStyle, string]> = {
  mounted(el, binding) { binding.value[0].hint(el, binding.value[1]); },
  updated(el, binding) {
    if (binding.value[1] !== binding.oldValue?.[1]) binding.value[0].hint(el, binding.value[1]);
  }
};
</script>

<template>
  <div v-if="panel === 'description'" data-vue-description>{{ text || t('No description available') }}</div>
  <div v-else-if="panel === 'playlists'" data-vue-playlists>
    <p v-if="playlistLoading" role="status">{{ t('Loading…') }}</p>
    <p v-if="playlistFailed" role="status">{{ t('Could not update playlists. Try again.') }}</p>
    <button v-for="item in playlists" :key="item.key" class="control playlist-option"
      :data-focus-id="`playlist:${item.key}`" :aria-pressed="item.selected" :disabled="playlistLoading"
      @click="savePlaylist?.(item.key)">{{ item.selected ? '✓ ' : '+ ' }}{{ item.title }}</button>
    <p v-if="!playlistLoading && !playlistFailed && !playlists?.length" role="status">{{ t('No editable playlists. Sign in to save videos.') }}</p>
    <button v-if="playlistFailed" class="control" data-focus-id="playlists:retry" :disabled="playlistLoading"
      @click="retryPlaylists?.()">{{ t('Retry') }}</button>
  </div>
  <div v-else-if="thread" data-vue-comments data-comment-detail>
    <CommentThread :key="thread.key" class="comment detail-parent" :item="thread" />
    <p class="detail-reply-count">{{ thread.replyCount ? t('{count} replies', { count: thread.replyCount }) : t('Replies') }}</p>
    <div class="detail-replies" :aria-label="t('Replies')">
      <CommentThread v-for="item in thread.replies.slice(0, replyLimit)" :key="item.key" class="comment" :item="item"
        :focus-key="`reply:${JSON.stringify([thread.key, item.key])}`" />
    </div>
    <p v-if="commentsStatus?.loading" role="status">{{ t('Loading replies…') }}</p>
    <p v-else-if="commentsStatus?.failed" role="status">{{ t('Could not load replies. Try again.') }}</p>
    <p v-else-if="thread.replies.length <= (replyLimit || 0) && !thread.hasReplies" role="status">{{ t('No more replies.') }}</p>
    <button v-if="thread.replies.length > (replyLimit || 0) || thread.hasReplies || commentsStatus?.failed"
      class="control" data-focus-id="replies:more" :disabled="commentsStatus?.loading" @click="replies">{{ t(commentsStatus?.failed ? 'Retry' : 'Show more replies') }}</button>
  </div>
  <div v-else data-vue-comments>
    <CommentThread v-for="item in records" :key="item.key" class="comment" :item="item"
      :open-thread="openThread" />
    <p v-if="commentsStatus?.loading" role="status">{{ t('Loading comments…') }}</p>
    <p v-else-if="commentsStatus?.failed" role="status">{{ t('Could not load comments. Retry to continue.') }}</p>
    <p v-else-if="commentsStatus && !commentsStatus.hasMore" role="status">{{ t('No more comments.') }}</p>
    <p v-else-if="!records.length" role="status" v-hint="[controllerStyle, unavailable
      ? t('Comments are unavailable. Playback continues normally. B Back.')
      : t('Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.')]"></p>
    <button v-if="(records.length || commentsStatus?.failed) && (!commentsStatus || commentsStatus.hasMore || commentsStatus.failed)"
      class="control" data-focus-id="comments:more" :disabled="commentsStatus?.loading" @click="load">{{ t(commentsStatus?.failed ? 'Retry' : 'Load more comments') }}</button>
  </div>
</template>
