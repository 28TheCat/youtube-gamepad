<script setup lang="ts">
import type { ControllerStyle } from '../../types/ports.js';
import type { SearchView, SearchViewActions } from './search-view';
import SearchKeyboard from './SearchKeyboard.vue';
import CandidateList from './CandidateList.vue';
defineProps<{ view: SearchView; actions: SearchViewActions; controllerStyle: ControllerStyle }>();
const vBadge = { mounted(el: HTMLElement, binding: { value: [ControllerStyle, string] }) { binding.value[0].badge(el, binding.value[1]); } };
const shortcuts = [['D-pad / left stick', 'Select'], ['A', 'Type'], ['X', 'Delete · Hold to repeat'],
  ['Y', 'Space'], ['LB / RB', 'Move cursor'], ['L3', 'Symbols'], ['R3', 'Candidates / history'],
  ['LT', 'Letter case'], ['RT', 'Search'], ['B', 'Back'], ['Start', 'Close']];
</script>

<template>
  <input id="query" data-focus-id="query" data-vue-search aria-label="Search query" autocomplete="off" placeholder="Search" :value="view.query"
    @input="actions.input($event.currentTarget as HTMLInputElement)" @select="actions.input($event.currentTarget as HTMLInputElement)"
    @keyup="actions.input($event.currentTarget as HTMLInputElement)" @click="actions.input($event.currentTarget as HTMLInputElement)"
    @keydown.enter="if (!$event.isComposing) { $event.preventDefault(); actions.submit(); }" />
  <div class="search-layout">
    <CandidateList :view="view" :actions="actions" :controllerStyle="controllerStyle" />
    <SearchKeyboard :rows="view.rows" :choosing-language="view.choosingLanguage" :controllerStyle="controllerStyle" @key="actions.key" @focus="actions.focus" />
  </div>
  <p id="message" role="status"></p>
  <p id="shortcuts" class="controls"><span v-for="[key, description] in shortcuts" :key="key" class="shortcut-item">
    <span class="shortcut-button" v-badge="[controllerStyle, key]"></span><span>{{ view.composing && key === 'Y' ? 'Confirm candidate' : view.composing && key === 'LB / RB' ? 'Change page' : description }}</span>
  </span></p>
</template>
