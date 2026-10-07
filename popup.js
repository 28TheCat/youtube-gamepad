const enabled = document.querySelector('#enabled');
const status = document.querySelector('#status');
chrome.storage.local.get({ enabled: true }, values => {
  enabled.checked = values.enabled;
  enabled.disabled = false;
});
enabled.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ enabled: enabled.checked });
    status.textContent = 'Saved';
  } catch (_) { status.textContent = 'Could not save. Please try again.'; }
});
document.querySelector('#moreSettings').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'ytg-open-inline-settings' });
    if (!result?.ok) throw new Error('YouTube unavailable');
    window.close();
  } catch (_) { status.textContent = 'Open a YouTube tab, then open settings here.'; }
});
async function refreshConnection() {
  const connection = document.querySelector('#connection');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const state = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'ytg-connection-status' });
    connection.textContent = state?.connected ? 'Gamepad connected (standard layout)' : 'No gamepad detected. Press a gamepad button on YouTube.';
  } catch (_) { connection.textContent = 'Open YouTube to check your gamepad connection'; }
}
refreshConnection();
setInterval(refreshConnection, 1000);
