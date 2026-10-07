const defaults = { enabled: true, theater: true, autoFullscreen: null, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140 };
// Hash links preserve direct entry points and browser back/forward navigation.
(() => {
  const links = [...document.querySelectorAll('[data-category-link]')];
  const panels = [...document.querySelectorAll('[data-category]')];
  const aliases = { general: 'general', display: 'display', shortcuts: 'controller', gamepad: 'controller', diagnostics: 'help', connectionHelp: 'help' };
  function showCategory() {
    const category = aliases[location.hash.slice(1)] || 'general';
    for (const panel of panels) panel.hidden = panel.dataset.category !== category;
    for (const link of links) {
      if (link.dataset.categoryLink === category) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  for (const [index, link] of links.entries()) {
    link.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % links.length;
      else if (event.key === 'ArrowUp') next = (index + links.length - 1) % links.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = links.length - 1;
      else return;
      event.preventDefault(); links[next].focus();
    });
  }
  window.addEventListener('hashchange', showCategory);
  showCategory();
})();
const status = document.querySelector('#status');
let statusTimer;
window.YTGamepadSettingsFeedback = (text, success = false) => {
  window.clearTimeout?.(statusTimer);
  status.textContent = text;
  status.hidden = false;
  if (success) statusTimer = window.setTimeout?.(() => {
    // Keep the message painted until the discrete display transition finishes.
    if (status.textContent === text) status.hidden = true;
  }, 2000);
};
const fields = Object.fromEntries(Object.keys(defaults).map(key => [key, document.getElementById(key)]));
const deadzoneValue = document.querySelector('#deadzoneValue');
let ready = false;
async function initialize() {
  try {
    const values = await chrome.storage.local.get(defaults);
    // Preserve the old combined preference before separating the two switches.
    if (typeof values.autoFullscreen !== 'boolean') {
      values.autoFullscreen = values.theater;
      await chrome.storage.local.set({ autoFullscreen: values.autoFullscreen });
    }
    for (const [key, input] of Object.entries(fields)) {
      if (input.type === 'checkbox') input.checked = values[key];
      else input.value = values[key];
    }
    deadzoneValue.textContent = fields.deadzone.value;
    ready = true;
    document.querySelector('fieldset').disabled = false;
  } catch (_) { window.YTGamepadSettingsFeedback('Could not load settings. Please reopen this page.'); }
}
fields.deadzone.addEventListener('input', () => { deadzoneValue.textContent = fields.deadzone.value; });
for (const [key, input] of Object.entries(fields)) input.addEventListener('change', async () => {
  if (!ready) return;
  if (!input.checkValidity()) { input.reportValidity(); window.YTGamepadSettingsFeedback('Please enter a valid number within the shown range'); return; }
  try {
    await chrome.storage.local.set({ [key]: input.type === 'checkbox' ? input.checked : Number(input.value) });
    window.YTGamepadSettingsFeedback('Saved', true);
  } catch (_) { window.YTGamepadSettingsFeedback('Could not save. Please try again.'); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !ready) return;
  for (const [key, change] of Object.entries(changes)) {
    const input = fields[key];
    if (!input) continue;
    const value = change.newValue ?? defaults[key];
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  deadzoneValue.textContent = fields.deadzone.value;
});
document.querySelector('form').addEventListener('submit', event => event.preventDefault());
initialize();
