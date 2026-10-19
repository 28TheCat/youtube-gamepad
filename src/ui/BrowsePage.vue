<script setup lang="ts">
import { useBrowseStore } from '../app/browse-store';
import type { VideoGridSettings } from '../shared/video-grid';
import BrowseSidebar from './BrowseSidebar.vue';
import BrowseCategoryTabs from './BrowseCategoryTabs.vue';
import BrowseGrid from './BrowseGrid.vue';
import BrowseHeader from './BrowseHeader.vue';
import ExplorePage from './ExplorePage.vue';
import { computed } from 'vue';
import { resolveExplorePage } from '../shared/explore-pages';
import type { mountBrowseMode } from './browse-mode';

defineProps<{
  browseMode: ReturnType<typeof mountBrowseMode>;
  open: (id: string) => void;
  more: () => void;
  ownsFocus: () => boolean;
  openSettings: () => void;
  gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void;
  refreshNavigation?: () => void;
  focusAccount?: (node: HTMLElement) => void;
}>();
const store = useBrowseStore();
const explorePage = computed(() => resolveExplorePage(store.snapshot.route));
</script>

<template>
  <BrowseHeader :browse-mode="browseMode" :refresh-navigation="refreshNavigation" :focus-account="focusAccount" />
  <BrowseSidebar :route="store.snapshot.route" @changed="refreshNavigation?.()" @settings="openSettings" />
  <BrowseCategoryTabs :categories="store.categories" :selected="store.category" @change="changeCategory?.($event)" />
  <ExplorePage v-if="explorePage" :key="explorePage.id" :page="explorePage" :open="open" :more="more"
    :owns-focus="ownsFocus" :grid-settings="gridSettings" :change-category="changeCategory" />
  <BrowseGrid v-else :open="open" :more="more" :owns-focus="ownsFocus" :grid-settings="gridSettings"
    :change-category="changeCategory" />
</template>
