/** Normalize YouTube's UI language to a bounded translation target. */
export function commentLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 35 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)) return;
  try {
    const language = Intl.getCanonicalLocales(value)[0];
    if (/^zh-(CN|SG)$/i.test(language)) return 'zh-Hans';
    if (/^zh-(TW|HK|MO)$/i.test(language)) return 'zh-Hant';
    return language;
  } catch { return; }
}
