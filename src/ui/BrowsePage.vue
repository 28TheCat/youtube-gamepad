<script setup lang="ts">
import { useBrowseStore } from '../app/browse-store';
import type { VideoGridSettings } from '../shared/video-grid';
import BrowseSidebar from './BrowseSidebar.vue';
import BrowseCategoryTabs from './BrowseCategoryTabs.vue';
import BrowseGrid from './BrowseGrid.vue';
import BrowseHeader from './BrowseHeader.vue';
import SubscriptionChannels from './SubscriptionChannels.vue';
import ExplorePage from './ExplorePage.vue';
import ChannelAvatar from './ChannelAvatar.vue';
import { computed, ref } from 'vue';
import { resolveExplorePage } from '../shared/explore-pages';
import type { mountBrowseMode } from './browse-mode';
import { useBrowseSidebar } from './use-browse-sidebar';

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
const { snapshot: sidebar, openRoute } = useBrowseSidebar(() => store.snapshot.route);
const subscriptionBrowsing = ref(false);
const explorePage = computed(() => resolveExplorePage(store.snapshot.route));
const showCategories = computed(() => {
  if (subscriptionBrowsing.value) return false;
  const pathname = new URL(store.snapshot.route || '/', location.origin).pathname;
  return pathname === '/' || store.categories.length !== 1 || store.categories[0].id !== 'all';
});
</script>

<template>
  <BrowseHeader :refresh-home="refreshHome" :browse-mode="browseMode" :refresh-navigation="refreshNavigation" :focus-account="focusAccount" />
  <BrowseSidebar :snapshot="sidebar" :open-route="openRoute" :refresh-home="refreshHome" :route="store.snapshot.route" @changed="refreshNavigation?.()" @settings="openSettings" />
  <section v-if="shellState.unsupported || shellState.unavailable" class="ytg-shell-status" role="status" data-ytg-shell-status>
    <h1>{{ shellState.unsupported ? '此页面尚未适配' : '暂时无法加载视频' }}</h1>
    <p>{{ shellState.unsupported ? '可以从侧栏继续浏览，或主动切换到 YouTube 原版界面。' : '界面已保留，请重试或从侧栏选择其他页面。' }}</p>
    <button v-if="shellState.unavailable" type="button" @click="retryFeed">重试</button>
    <button type="button" @click="openOriginal">打开 YouTube 原页面</button>
  </section>
  <template v-else>
  <BrowseCategoryTabs v-if="showCategories" :categories="store.categories" :selected="store.category" @change="changeCategory?.($event)" />
  <SubscriptionChannels :channels="sidebar?.subscriptions || []" :open-route="openRoute" :route="store.snapshot.route" @browsing="subscriptionBrowsing = $event" @changed="refreshNavigation?.()">
  <ExplorePage v-if="explorePage" :key="explorePage.id" :page="explorePage" :open="open" :more="more"
    :owns-focus="ownsFocus" :grid-settings="gridSettings" :change-category="changeCategory" />
  <BrowseGrid v-else :open="open" :more="more" :owns-focus="ownsFocus" :grid-settings="gridSettings"
    :change-category="changeCategory">
    <template #heading>
      <header v-if="!subscriptionBrowsing && store.snapshot.channelHeader" class="channel-page-heading" data-ytg-channel-header>
        <img v-if="store.snapshot.channelHeader.banner" class="channel-banner" :src="store.snapshot.channelHeader.banner" alt="" @error="($event.target as HTMLImageElement).hidden = true" />
        <div class="channel-profile">
          <ChannelAvatar :src="store.snapshot.channelHeader.avatar" :name="store.snapshot.channelHeader.title" :lazy="false" />
          <div class="channel-summary">
            <h1>{{ store.snapshot.channelHeader.title }}</h1>
            <p v-if="store.snapshot.channelHeader.metadata" class="channel-statistics">{{ store.snapshot.channelHeader.metadata }}</p>
            <p v-if="store.snapshot.channelHeader.description" class="channel-description">{{ store.snapshot.channelHeader.description }}</p>
          </div>
        </div>
      </header>
    </template>
  </BrowseGrid>
  </SubscriptionChannels>
  </template>
</template>
