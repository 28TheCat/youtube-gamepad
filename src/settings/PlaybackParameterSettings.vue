<script setup lang="ts">
import { playbackParameters, playbackParameterDefaults, type PlaybackParameters } from '../shared/playback-settings';
import { useI18n } from '../shared/use-i18n';
import NumberSettingRow from './NumberSettingRow.vue';
defineProps<{ values: PlaybackParameters; disabled?: boolean; gamepad?: boolean }>();
const emit = defineEmits<{ save: [values: Partial<PlaybackParameters>, id: string] }>();
const { t } = useI18n();
</script>
<template>
  <div class="playback-parameter-settings">
    <h3>{{ t('Playback parameters') }}</h3>
    <p>{{ t('Choose the seek distance and volume change per press. Changes apply immediately.') }}</p>
    <NumberSettingRow v-for="item in playbackParameters" :key="item.key" :item="item" :value="values[item.key]"
      :class="{ 'parameter-row': !gamepad }" :disabled="disabled" :gamepad="gamepad"
      @change="(value, id) => emit('save', { [item.key]: value }, id)" />
    <button type="button" data-setting="resetPlaybackParameters" :disabled="disabled"
      @click="emit('save', { ...playbackParameterDefaults }, 'resetPlaybackParameters')">{{ t('Restore playback defaults') }}</button>
  </div>
</template>
