<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from '../shared/use-i18n';
import { useSettingsStore } from './store';
import { createDeadzoneCalibration, outsideDeadzone, readGamepads, type GamepadReading } from './gamepad-test';
const { t } = useI18n();
const settings = useSettingsStore();
const navigationStick = computed(() => settings.values.rightHandMode ? 2 : 0);
const devices = ref<GamepadReading[]>([]), selected = ref<number | null>(null), error = ref('');
const focused = ref(document.hasFocus() && !document.hidden);
const pad = computed(() => devices.value.find(device => device.index === selected.value));
const pairs = computed(() => pad.value ? Array.from({ length: Math.ceil(pad.value.axes.length / 2) }, (_, pair) => ({
  index: pair * 2, x: pad.value!.axes[pair * 2], y: pad.value!.axes[pair * 2 + 1] ?? 0,
  label: pad.value!.mapping === 'standard' && pair < 2 ? (pair === 0 ? 'Left stick' : 'Right stick') : `Axes {x} / {y}`
})) : []);
const draft = ref(settings.values.deadzone), previewing = ref(false);
const threshold = computed(() => previewing.value ? draft.value : settings.values.deadzone);
const calibration = createDeadzoneCalibration();
const calibrating = ref(false), progress = ref(0), peak = ref(0), suggestion = ref<number | null>(null), message = ref('');
let frame = 0, lastPoll = -Infinity, currentIdentity = '';
function cancelCalibration(text = '') {
  calibration.cancel(); calibrating.value = false; progress.value = 0; suggestion.value = null; message.value = text;
}
function startCalibration() {
  if (!pad.value || !focused.value) return;
  suggestion.value = null; peak.value = 0; progress.value = 0;
  calibrating.value = calibration.start(pad.value, performance.now(), navigationStick.value);
  message.value = calibrating.value ? 'Release the navigation stick and leave it untouched for 3 seconds.' : '';
}
watch(navigationStick, () => cancelCalibration('Navigation stick changed. Start calibration again.'));
function selectDevice(event: Event) {
  selected.value = Number((event.target as HTMLSelectElement).value);
  cancelCalibration(); previewing.value = false;
}
function preview(event: Event) { draft.value = Number((event.target as HTMLInputElement).value); previewing.value = true; }
async function apply(value: number) {
  await settings.saveValues({ deadzone: value });
  if (settings.values.deadzone === value) previewing.value = false;
}
function read(time: number) {
  frame = requestAnimationFrame(read);
  if (!focused.value || time - lastPoll < 50) return;
  lastPoll = time;
  try {
    if (!navigator.getGamepads) { error.value = 'This browser does not provide gamepad detection.'; return; }
    const next = readGamepads(navigator.getGamepads());
    error.value = ''; devices.value = next;
    if (!next.some(device => device.index === selected.value)) selected.value = next[0]?.index ?? null;
    const device = next.find(device => device.index === selected.value);
    const identity = device ? `${device.index}:${device.id}:${device.mapping}` : '';
    if (identity !== currentIdentity) {
      cancelCalibration(currentIdentity ? 'Device changed or disconnected. Start calibration again.' : '');
      previewing.value = false; currentIdentity = identity;
    }
    if (calibrating.value) {
      const result = calibration.sample(device, time);
      progress.value = result.progress; peak.value = result.peak;
      if (result.state !== 'sampling') {
        calibrating.value = false;
        suggestion.value = result.suggestion ?? null;
        message.value = result.state === 'complete' ? 'Calibration complete. Review the suggested deadzone before applying.'
          : result.state === 'moving' ? 'Too much stick movement. Release the stick and try again.'
          : 'Calibration interrupted. Keep this page active and try again.';
      }
    }
  } catch {
    devices.value = []; selected.value = null; cancelCalibration();
    error.value = 'Gamepad detection is unavailable. Check browser permissions and try reopening this page.';
  }
}
function activity() {
  focused.value = document.hasFocus() && !document.hidden;
  if (!focused.value) {
    if (calibrating.value) cancelCalibration('Calibration interrupted. Keep this page active and try again.');
    devices.value = []; // Do not leave stale button presses visible while paused.
  } else lastPoll = -Infinity;
}
onMounted(() => {
  window.addEventListener('focus', activity); window.addEventListener('blur', activity);
  document.addEventListener('visibilitychange', activity); frame = requestAnimationFrame(read);
});
onUnmounted(() => {
  cancelAnimationFrame(frame); calibration.cancel();
  window.removeEventListener('focus', activity); window.removeEventListener('blur', activity);
  document.removeEventListener('visibilitychange', activity);
});
</script>

<template>
  <section id="gamepadTest" aria-labelledby="gamepadTestTitle">
    <div class="section-heading"><h2 id="gamepadTestTitle">{{ t('Gamepad detection & calibration') }}</h2>
      <p>{{ t('Connect a gamepad, click this page, then press a gamepad button to make it visible to the browser.') }}</p></div>
    <p class="gamepad-test-status" role="status">{{ t(error || (!focused ? 'Detection paused. Return to this page to continue.' : devices.length ? '{count} gamepads detected' : 'No gamepad detected yet.'), { count: devices.length }) }}</p>
    <template v-if="pad && focused && !error">
      <label for="testDevice">{{ t('Device to test') }}</label>
      <select id="testDevice" :value="selected" @change="selectDevice"><option v-for="device in devices" :key="device.index" :value="device.index">{{ device.index + 1 }} · {{ device.id || t('Unnamed gamepad') }}</option></select>
      <dl class="gamepad-test-info"><div><dt>{{ t('Browser device name') }}</dt><dd>{{ pad.id || t('Unnamed gamepad') }}</dd></div>
        <div><dt>{{ t('Mapping') }}</dt><dd>{{ t(pad.mapping === 'standard' ? 'Standard mapping · supported' : 'Non-standard mapping · detection only') }}</dd></div>
        <div><dt>{{ t('Inputs') }}</dt><dd>{{ t('{buttons} buttons · {axes} axes', { buttons: pad.buttons.length, axes: pad.axes.length }) }}</dd></div></dl>
      <p v-if="pad.mapping !== 'standard'" class="binding-note">{{ t('This device is visible to the browser, but cannot control YouTube yet. The readings below show raw input numbers; custom device mapping is not available yet.') }}</p>
      <h3>{{ t('Button test') }}</h3><p>{{ t('Press each button. Triggers also show how far they are pressed. Numbers are browser input indices, starting at 0.') }}</p>
      <div class="gamepad-test-buttons"><div v-for="(button, index) in pad.buttons" :key="index" class="gamepad-test-button" :data-button-index="index" :data-pressed="button.pressed">
        <strong>{{ t('Button {index}', { index }) }}</strong><span>{{ t(button.pressed ? 'Pressed' : button.touched ? 'Touched' : 'Released') }}</span>
        <meter min="0" max="1" :value="button.value" :aria-label="t('Button {index}', { index })" /> <output>{{ button.value.toFixed(2) }}</output>
      </div></div>
      <h3>{{ t('Stick & axis test') }}</h3><p>{{ t('Move each stick through its full range, then release it. The square marks the deadzone used for navigation.') }}</p>
      <div class="gamepad-test-sticks"><div v-for="pair in pairs" :key="pair.index" class="gamepad-test-stick" :data-axis-pair="pair.index">
        <h4>{{ t(pair.label, { x: pair.index, y: pair.index + 1 }) }}</h4>
        <div class="gamepad-test-plot" aria-hidden="true"><div class="gamepad-test-zone" :style="{ width: threshold * 100 + '%', height: threshold * 100 + '%' }" />
          <span class="gamepad-test-dot" :data-outside="outsideDeadzone(pair.x, pair.y, threshold)" :style="{ left: (pair.x + 1) * 50 + '%', top: (pair.y + 1) * 50 + '%' }" /></div>
        <p class="gamepad-test-values">{{ pair.index }}: {{ pair.x.toFixed(3) }} <template v-if="pair.index + 1 < pad.axes.length"> · {{ pair.index + 1 }}: {{ pair.y.toFixed(3) }}</template></p>
        <span>{{ t(outsideDeadzone(pair.x, pair.y, threshold) ? 'Outside deadzone' : 'Inside deadzone') }}</span>
      </div></div>
      <p class="gamepad-test-note">{{ t('Navigation stick: {stick}. Extra axes are shown for testing only.', { stick: t(navigationStick === 2 ? 'Right stick' : 'Left stick') }) }}</p>
      <div class="gamepad-test-calibration">
        <h3>{{ t('Stick deadzone') }}</h3><p>{{ t('This setting applies to all supported gamepads. Preview changes here, then apply them to YouTube.') }}</p>
        <div class="gamepad-test-adjust"><label for="testDeadzone">{{ t('Preview deadzone') }} <output for="testDeadzone">{{ threshold.toFixed(2) }}</output></label>
          <input id="testDeadzone" type="range" min="0.15" max="0.75" step="0.05" :value="threshold" @input="preview" :disabled="calibrating">
          <button type="button" class="secondary-button" @click="apply(threshold)" :disabled="!settings.ready || settings.saving || calibrating || !previewing">{{ t('Apply preview') }}</button></div>
        <div class="gamepad-test-actions"><button type="button" class="secondary-button" @click="startCalibration" :disabled="pad.mapping !== 'standard' || pad.axes.length < navigationStick + 2 || calibrating || !settings.ready || settings.saving">{{ t('Measure stick drift') }}</button>
          <button v-if="calibrating" type="button" class="secondary-button" @click="cancelCalibration('Calibration cancelled.')">{{ t('Cancel') }}</button>
          <button v-if="suggestion !== null" type="button" class="secondary-button" @click="apply(suggestion)" :disabled="!settings.ready || settings.saving || settings.values.deadzone === suggestion">{{ t('Apply suggested deadzone: {value}', { value: suggestion.toFixed(2) }) }}</button></div>
        <progress v-if="calibrating" max="1" :value="progress" :aria-label="t('Measuring stick drift')" />
        <p role="status">{{ t(message) }}</p><p v-if="calibrating || suggestion !== null">{{ t('Largest resting offset: {value}', { value: peak.toFixed(3) }) }}</p>
        <p v-if="pad.mapping !== 'standard' || pad.axes.length < navigationStick + 2">{{ t('Automatic deadzone calibration requires a standard-mapped navigation stick.') }}</p>
      </div>
    </template>
    <p v-else-if="focused && !error">{{ t('If nothing appears, check the system gamepad connection or try another USB cable. Browsers may hide a connected device until you press a button on this page.') }}</p>
    <p class="gamepad-test-note">{{ t('Live readings stay on this page and are not saved or uploaded. Only a deadzone value you apply is saved.') }}</p>
  </section>
</template>

