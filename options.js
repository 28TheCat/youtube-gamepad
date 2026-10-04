const defaults = { enabled: true, theater: true, autoFullscreen: null, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140 };
const status = document.querySelector('#status');
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
  } catch (_) { status.textContent = '无法读取设置，请重新打开此页'; }
}
fields.deadzone.addEventListener('input', () => { deadzoneValue.textContent = fields.deadzone.value; });
for (const [key, input] of Object.entries(fields)) input.addEventListener('change', async () => {
  if (!ready) return;
  if (!input.checkValidity()) { input.reportValidity(); status.textContent = '请按提示输入有效数值'; return; }
  try {
    await chrome.storage.local.set({ [key]: input.type === 'checkbox' ? input.checked : Number(input.value) });
    status.textContent = '已保存';
  } catch (_) { status.textContent = '保存失败，请重试'; }
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
