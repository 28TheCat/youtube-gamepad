const enabled = document.querySelector('#enabled');
const status = document.querySelector('#status');
chrome.storage.local.get({ enabled: true }, values => {
  enabled.checked = values.enabled;
  enabled.disabled = false;
});
enabled.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ enabled: enabled.checked });
    status.textContent = '已保存';
  } catch (_) { status.textContent = '保存失败，请重试'; }
});
document.querySelector('#moreSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
async function refreshConnection() {
  const connection = document.querySelector('#connection');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const state = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'ytg-connection-status' });
    connection.textContent = state?.connected ? '手柄已连接（标准布局）' : '未检测到手柄 · 请在 YouTube 页面按一次手柄按键';
  } catch (_) { connection.textContent = '请打开 YouTube 页面查看手柄连接状态'; }
}
refreshConnection();
setInterval(refreshConnection, 1000);
