<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import type { Directive } from 'vue';
import type { CommentSnapshot, ControllerStyle, SavedPlaylistSnapshot } from '../../types/ports';
defineProps<{
  panel: 'description' | 'comments' | 'playlists'; text: string; records: readonly CommentSnapshot[];
  collapsed: readonly string[]; unavailable: boolean; controllerStyle: ControllerStyle;
  toggle: (key: string) => void; replies: (key: string) => void; load: () => void;
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
  <div v-else data-vue-comments>
    <div v-for="item in records" :key="item.key" class="comment">
      <button class="comment-header" :data-focus-id="`comment:${item.key}`"
        :aria-expanded="!collapsed.includes(item.key)" @click="toggle(item.key)">
        <span class="comment-toggle">{{ collapsed.includes(item.key) ? '+' : '−' }}</span>
        <span class="comment-author">{{ item.author }}</span>
        <span v-if="collapsed.includes(item.key)" class="comment-summary">{{ t("Comment collapsed") }}</span>
      </button>
      <div class="comment-body" :hidden="collapsed.includes(item.key)">
        <div>{{ item.text }}</div>
        <div v-if="item.expanded.length" class="comment-replies-list">
          <div v-for="(reply, index) in item.expanded" :key="index" class="comment-reply">↳ {{ reply }}</div>
        </div>
        <button v-if="item.hasReplies" class="comment-replies" :disabled="commentsStatus?.loading" :data-focus-id="`replies:${item.key}`" @click="replies(item.key)">
          {{ t(item.repliesLabel) }}<span v-hint="[controllerStyle, t(' · A Load replies')]"></span>
        </button>
      </div>
    </div>
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
