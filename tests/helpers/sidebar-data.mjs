const entry = (label, href, icon, browseId = 'FEfixture') => ({ guideEntryRenderer: {
  formattedTitle: { simpleText: label }, icon: { iconType: icon },
  navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: href } },
    ...(href.startsWith('https:') ? { urlEndpoint: { url: href } } : { browseEndpoint: { browseId } }) }
} });
export function guideData() {
  return { items: [
    { guideSectionRenderer: { items: [entry('Home', '/', 'WHAT_TO_WATCH'), entry('Subscriptions', '/feed/subscriptions', 'SUBSCRIPTIONS')] } },
    { guideSectionRenderer: { items: [{ guideCollapsibleSectionEntryRenderer: {
      headerEntry: entry('You', '/feed/you', 'ACCOUNT_BOX'), expanderIcon: { iconType: 'EXPAND_MORE' }, collapserIcon: { iconType: 'EXPAND_LESS' },
      sectionItems: [entry('History', '/feed/history', 'WATCH_HISTORY'),
        entry('Your videos', 'https://studio.youtube.com/channel/UCcreator/videos', 'MY_VIDEOS')]
    } }] } },
    { guideSectionRenderer: { formattedTitle: { simpleText: 'Découvrir' }, items: [
      entry('Musique régionale', '/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'MUSIC'),
      { guideCollapsibleEntryRenderer: { expandableItems: [entry('Games', '/gaming', 'GAMING'),
        entry('Duplicate Games', '/gaming', 'GAMING'), entry('Unsafe', 'https://evil.example/gaming', 'GAMING') ] } }
    ] } },
    { guideSubscriptionsSectionRenderer: { items: [entry('Subscribed creator', '/channel/UCsubscriber', 'MUSIC')] } }
  ] };
}
