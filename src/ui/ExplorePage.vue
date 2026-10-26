<script setup lang="ts">
import type { ExplorePageDefinition } from '../shared/explore-pages';
import type { VideoGridSettings } from '../shared/video-grid';
import { useI18n } from '../shared/use-i18n';
import BrowseGrid from './BrowseGrid.vue';
import InterfaceIcon from './InterfaceIcon.vue';
defineProps<{
  page: ExplorePageDefinition;
  open: (id: string) => void;
  more: () => void;
  ownsFocus: () => boolean;
  gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void;
}>();
const { t } = useI18n();
</script>

<template>
  <BrowseGrid :open="open" :more="more" :owns-focus="ownsFocus" :grid-settings="gridSettings"
    :change-category="changeCategory" :page-title="t(page.label)">
    <template #heading>
      <header class="explore-page-heading" :data-ytg-explore-page="page.id">
        <span class="explore-page-symbol"><InterfaceIcon name="explore" filled /></span>
        <div><p>{{ t('Explore') }}</p><h1>{{ t(page.label) }}</h1><p>{{ t(page.description) }}</p></div>
      </header>
    </template>
  </BrowseGrid>
</template>
