<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import CommentThread from './CommentThread.vue';
import LoadStatus from './LoadStatus.vue';
const { t } = useI18n();
import type { Directive } from 'vue';
import type { CommentSnapshot, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';
defineProps<{
  panel: 'description' | 'comments' | 'playlists' | 'subscription'; text: string; records: readonly CommentSnapshot[];
  unavailable: boolean; controllerStyle: ControllerStyle; thread?: CommentSnapshot; replyLimit?: number;
  openThread: (key: string) => void; replies: () => void; load: () => void;
  translate?: (key: string) => void;
  commentsStatus?: { loading: boolean; failed: boolean; hasMore: boolean };
  notificationPreference?: import('../../types/ports').NotificationPreference; subscriptionLoading?: boolean; subscriptionFailed?: boolean;
  subscriptionAction?: (action: import('../../types/ports').WatchAction) => void;
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
  <div v-else-if="panel === 'subscription'" data-vue-subscription>
    <div role="group" :aria-label="t('Notifications')">
      <button v-for="[preference, action, label] in [['ALL', 'notificationsAll', 'All'], ['PERSONALIZED', 'notificationsPersonalized', 'Personalized'], ['NONE', 'notificationsNone', 'None']] as const" :key="action"
        class="control subscription-option" :data-focus-id="action" :aria-pressed="notificationPreference === preference" :disabled="subscriptionLoading"
        @click="subscriptionAction?.(action)"><span class="subscription-check" aria-hidden="true">{{ notificationPreference === preference ? '✓' : '' }}</span>{{ t(label) }}</button>
    </div>
    <button class="control subscription-option unsubscribe-option" data-focus-id="unsubscribe" :disabled="subscriptionLoading" @click="subscriptionAction?.('unsubscribe')">{{ t('Unsubscribe') }}</button>
    <LoadStatus :loading="subscriptionLoading" :failed="subscriptionFailed"
      :loading-message="t('Saving…')" :error-message="t('Could not update subscription. Try again.')" />
  </div>
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
    <CommentThread :key="thread.key" class="comment detail-parent" :item="thread" :translate="translate" :controller-style="controllerStyle" />
    <div class="detail-children">
      <div class="detail-branch reply-summary">
        <span class="reply-threadline" aria-hidden="true"><span class="reply-connection"></span><span v-if="thread.replies.length" class="reply-continuation"></span></span>
        <p class="detail-reply-count">{{ thread.replyCount ? t('{count} replies', { count: thread.replyCount }) : t('Replies') }}</p>
      </div>
      <div class="detail-replies" :aria-label="t('Replies')">
        <div v-for="item in thread.replies.slice(0, replyLimit)" :key="item.key" class="detail-branch">
          <span class="reply-threadline" aria-hidden="true"><span class="reply-connection"></span><span class="reply-continuation"></span></span>
          <div class="detail-branch-content">
            <CommentThread class="comment" :item="item" :focus-key="`reply:${JSON.stringify([thread.key, item.key])}`"
              :translate="translate" :controller-style="controllerStyle" />
          </div>
        </div>
      </div>
    </div>
    <LoadStatus :loading="commentsStatus?.loading" :failed="commentsStatus?.failed"
      :empty="thread.replies.length <= (replyLimit || 0) && !thread.hasReplies" error-role="status"
      :loading-message="t('Loading replies…')" :error-message="t('Could not load replies. Try again.')" :empty-message="t('No more replies.')"
      retryable :retry-attributes="{ class: 'control', 'data-focus-id': 'replies:more' }" @retry="replies" />
    <button v-if="!commentsStatus?.failed && (thread.replies.length > (replyLimit || 0) || thread.hasReplies)"
      class="control" data-focus-id="replies:more" :disabled="commentsStatus?.loading" @click="replies">{{ t('Show more replies') }}</button>
  </div>
  <div v-else data-vue-comments>
    <CommentThread v-for="item in records" :key="item.key" class="comment" :item="item"
      :open-thread="openThread" :translate="translate" :controller-style="controllerStyle" />
    <LoadStatus :loading="commentsStatus?.loading" :failed="commentsStatus?.failed"
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
