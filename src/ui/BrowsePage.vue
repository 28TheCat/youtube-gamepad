<script setup lang="ts">
import { useBrowseStore } from '../app/browse-store';
import type { VideoGridSettings } from '../shared/video-grid';
import BrowseSidebar from './BrowseSidebar.vue';
import BrowseCategoryTabs from './BrowseCategoryTabs.vue';
import BrowseGrid from './BrowseGrid.vue';
import BrowseHeader from './BrowseHeader.vue';
import SubscriptionChannels from './SubscriptionChannels.vue';
import ExplorePage from './ExplorePage.vue';
import { computed } from 'vue';
import { resolveExplorePage } from '../shared/explore-pages';
import type { mountBrowseMode } from './browse-mode';

defineProps<{
  shellState: { unsupported: string; unavailable: boolean };
  retryFeed: () => void;
  openOriginal: () => void;
  browseMode: ReturnType<typeof mountBrowseMode>;
  open: (id: string) => void;
  more: (manual?: boolean) => void;
  ownsFocus: () => boolean;
  openSettings: () => void;
  gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void;
  refreshHome?: () => void;
  refreshNavigation?: () => void;
  focusAccount?: (node: HTMLElement) => void;
}>();
const store = useBrowseStore();
const explorePage = computed(() => resolveExplorePage(store.snapshot.route));
</script>

<template>
  <BrowseHeader :refresh-home="refreshHome" :browse-mode="browseMode" :refresh-navigation="refreshNavigation" :focus-account="focusAccount" />
  <BrowseSidebar :refresh-home="refreshHome" :route="store.snapshot.route" @changed="refreshNavigation?.()" @settings="openSettings" />
  <section v-if="shellState.unsupported || shellState.unavailable" class="ytg-shell-status" role="status" data-ytg-shell-status>
    <h1>{{ shellState.unsupported ? '此页面尚未适配' : '暂时无法加载视频' }}</h1>
    <p>{{ shellState.unsupported ? '可以从侧栏继续浏览，或主动切换到 YouTube 原版界面。' : '界面已保留，请重试或从侧栏选择其他页面。' }}</p>
    <button v-if="shellState.unavailable" type="button" @click="retryFeed">重试</button>
    <button type="button" @click="openOriginal">打开 YouTube 原页面</button>
  </section>
  <template v-else>
  <BrowseCategoryTabs :categories="store.categories" :selected="store.category" @change="changeCategory?.($event)" />
  <SubscriptionChannels :route="store.snapshot.route" @changed="refreshNavigation?.()">
  <ExplorePage v-if="explorePage" :key="explorePage.id" :page="explorePage" :open="open" :more="more"
    :owns-focus="ownsFocus" :grid-settings="gridSettings" :change-category="changeCategory" />
  <BrowseGrid v-else :open="open" :more="more" :owns-focus="ownsFocus" :grid-settings="gridSettings"
    :change-category="changeCategory" />
  </SubscriptionChannels>
  </template>
</template>
