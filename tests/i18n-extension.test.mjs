import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture } from './helpers/extension.mjs';
test('language settings persist, update open tabs and popup, and keep keyboard preferences separate', { timeout: 60000 }, async t => {
  const { context, worker, id, options } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en', enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture,
    headers: { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } }));
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    await page.goto('https://www.youtube.com/');
    await page.evaluate(() => localStorage.setItem('ytg-keyboard-language', 'en'));
    await page.locator('#ytg-sidebar-settings').click();
    await page.locator('[data-setting="general"]').click();
  }
  const page = pages[0];
  await page.locator('[data-setting="language-zh-CN"]').click();
  for (const tab of pages) {
    await tab.getByRole('heading', { name: '界面语言', exact: true }).waitFor();
    assert.equal(await tab.locator('[data-setting="language-zh-CN"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await tab.evaluate(() => localStorage.getItem('ytg-keyboard-language')), 'en');
  }
  await options.getByRole('heading', { name: '通用', exact: true }).waitFor();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.getByRole('button', { name: '在 YouTube 上打开设置' }).waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('uiLanguage')).uiLanguage), 'zh-CN');
  await page.screenshot({ path: 'output/playwright/settings-language-zh.png' });
  await page.getByRole('button', { name: '返回快捷菜单', exact: true }).click();
  await page.getByRole('heading', { name: '快捷菜单', exact: true }).waitFor();
  await page.getByRole('button', { name: '搜索视频', exact: true }).click();
  await page.locator('#yt-gamepad-menu #query').fill('Settings');
  await page.getByRole('button', { name: '切换输入语言', exact: true }).waitFor();
  await options.selectOption('#uiLanguage', 'en');
  await page.getByRole('button', { name: 'Switch input language', exact: true }).waitFor();
  assert.equal(await page.locator('#yt-gamepad-menu #query').inputValue(), 'Settings', 'language updates preserve user input');
  await page.reload();
  await page.locator('#ytg-sidebar-settings').click();
  await page.locator('[data-setting="general"]').click();
  await page.locator('[data-setting="language-zh-CN"]').click();
  await page.locator('[data-setting="display"]').click();
  await page.getByRole('heading', { name: '视频卡片网格', exact: true }).waitFor();
  await options.selectOption('#uiLanguage', 'en');
  await page.getByRole('heading', { name: 'Video card grid', exact: true }).waitFor();
  await popup.getByRole('button', { name: 'Open settings on YouTube' }).waitFor();
  await pages[1].reload();
  await pages[1].locator('#ytg-sidebar-settings').click();
  await pages[1].locator('[data-setting="general"]').click();
  await pages[1].getByRole('heading', { name: 'Interface language', exact: true }).waitFor();
});
