export function accountData(selected = 0) {
  return { actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [
    { accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [0, 1].map(index => ({ accountItem: {
      accountName: { simpleText: index ? '<img> Other creator' : 'Example Creator' },
      channelHandle: { simpleText: index ? '@other' : '@example' },
      accountPhoto: { thumbnails: [{ url: `https://yt3.ggpht.com/account-${index}`, width: 88 }] },
      isSelected: index === selected, hasChannel: true,
      serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ privateToken: 'never-cross-the-bridge' }] } }
    } })) } }] } }
  ] } } } }] };
}
