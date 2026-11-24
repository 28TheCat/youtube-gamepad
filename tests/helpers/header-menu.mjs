export async function openBrowseMenu(page) {
  const menu = page.locator('#yt-gamepad-menu');
  if (!await menu.isVisible()) await page.locator('#ytg-browse-top .client-menu').click();
  await menu.locator('[data-vue-quick-menu]').waitFor();
  return { menu, mode: menu.locator('[data-ytg-page-mode]') };
}

export async function toggleBrowseMode(page) {
  const { menu, mode } = await openBrowseMenu(page);
  const previous = await mode.getAttribute('aria-checked');
  await mode.click();
  await page.waitForFunction(previous => {
    const button = document.querySelector('#yt-gamepad-menu')?.shadowRoot?.querySelector('[data-ytg-page-mode]');
    return button && !button.disabled && button.getAttribute('aria-checked') !== previous;
  }, previous);
  await menu.getByRole('button', { name: /^(Back|返回)$/ }).click();
  await menu.waitFor({ state: 'hidden' });
}
