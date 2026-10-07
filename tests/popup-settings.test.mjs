import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(available) {
  const fields = Object.fromEntries(['enabled', 'status', 'moreSettings', 'connection'].map(id => [id, {
    handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }
  }]));
  const sent = []; let closed = false;
  runInNewContext(readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), {
    document: { querySelector: selector => fields[selector.slice(1)] },
    window: { close() { closed = true; } }, setInterval() {},
    chrome: {
      storage: { local: { get(defaults, callback) { callback(defaults); }, async set() {} } },
      tabs: { async query() { return [{ id: 3 }]; }, async sendMessage(id, message) {
        sent.push({ id, ...message });
        if (!available) throw new Error('No content script');
        return { ok: true, connected: true };
      } }
    }
  });
  return { fields, sent, closed: () => closed };
}
test('toolbar opens the active YouTube menu rather than an options tab', async () => {
  const s = setup(true);
  await s.fields.moreSettings.handlers.click();
  assert.ok(s.sent.some(message => message.id === 3 && message.type === 'ytg-open-inline-settings'));
  assert.equal(s.closed(), true);
});
test('toolbar explains how to reach inline settings when no YouTube tab is available', async () => {
  const s = setup(false);
  await s.fields.moreSettings.handlers.click();
  assert.equal(s.closed(), false);
  assert.match(s.fields.status.textContent, /Open a YouTube tab/);
});
