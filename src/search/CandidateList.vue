<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import type { ControllerStyle } from '../../types/ports.js';
import type { SearchView, SearchViewActions } from './search-view';
import SearchDiscovery from './SearchDiscovery.vue';
defineProps<{ view: SearchView; actions: SearchViewActions; controllerStyle: ControllerStyle }>();
const vHint = { mounted(el: HTMLElement, binding: { value: ControllerStyle }) { binding.value.hint(el, ' · R3 Candidates · Y Confirm · LB / RB Page'); } };
</script>

<template>
  <div id="recent">
    <div id="composition" :hidden="!view.chinese || !view.composing">
      <p>{{ t("Pinyin:") }} {{ view.composing }}<span v-if="view.composing" v-hint="controllerStyle"></span></p>
      <div v-if="view.composing" class="candidate-row">
        <button v-for="(candidate, index) in view.candidates" :key="`${candidate.key}:${candidate.text}:${candidate.consumed}`"
          :data-focus-id="`candidate:${candidate.key}:${candidate.text}`" data-row="-1" :data-column="index"
          @focus="actions.focus($event.currentTarget as HTMLButtonElement)" @click="actions.candidate(candidate)">{{ candidate.text }}</button>
        <button v-if="view.previous" data-focus-id="candidate:previous" data-row="-1" :data-column="view.candidates.length"
          @focus="actions.focus($event.currentTarget as HTMLButtonElement)" @click="actions.page(-1)">{{ t("Previous page") }}</button>
        <button v-if="view.next" data-focus-id="candidate:next" data-row="-1" :data-column="view.candidates.length + Number(view.previous)"
          @focus="actions.focus($event.currentTarget as HTMLButtonElement)" @click="actions.page(1)">{{ t("Next page") }}</button>
        <button data-focus-id="candidate:raw" data-row="-1" :data-column="view.candidates.length + Number(view.previous) + Number(view.next)"
          @focus="actions.focus($event.currentTarget as HTMLButtonElement)" @click="actions.raw()">{{ t("Use typed text:") }} {{ view.composing }}</button>
      </div>
    </div>
    <SearchDiscovery v-if="!view.composing && !view.choosingLanguage"
      :query="view.query" :recent="view.recent" @search="actions.recent" @focus="actions.focus" />
  </div>
</template>
