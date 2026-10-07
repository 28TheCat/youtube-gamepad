// Function catalog. Physical buttons and user bindings belong in bindings.js.
(() => {
  const groups = Object.freeze({ navigation: 'Navigation', playback: 'Playback', progress: 'Playback position', audio: 'Audio', captions: 'Captions', information: 'Video information', interaction: 'Video interactions', page: 'Page actions', keyboard: 'Search keyboard', internal: 'Internal actions' });
  const definitions = [
    ['up', 'Move up', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search'], 'repeat'],
    ['down', 'Move down', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search'], 'repeat'],
    ['left', 'Move left', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search'], 'repeat'],
    ['right', 'Move right', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search'], 'repeat'],
    ['confirm', 'Confirm / select', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search']],
    ['back', 'Back / close', 'navigation', 'navigation', ['browse', 'watch', 'menu', 'search']],
    ['playPause', 'Play / pause', 'playback', 'media', ['watch']],
    ['seekBack', 'Rewind', 'progress', 'media', ['watch'], 'repeat', { parameter: { name: 'step', unit: 'seconds', default: 10 }, controlLabel: 'Rewind 10 seconds' }],
    ['seekForward', 'Forward', 'progress', 'media', ['watch'], 'repeat', { parameter: { name: 'step', unit: 'seconds', default: 10 }, controlLabel: 'Forward 10 seconds' }],
    ['adjustProgress', 'Adjust playback position', 'progress', 'progress', ['watch']],
    ['volumeDown', 'Volume down', 'audio', 'media', ['watch'], 'repeat', { parameter: { name: 'step', unit: 'percent', default: 5 }, menuLabel: 'Volume −' }],
    ['volumeUp', 'Volume up', 'audio', 'media', ['watch'], 'repeat', { parameter: { name: 'step', unit: 'percent', default: 5 }, menuLabel: 'Volume +' }],
    ['mute', 'Mute / unmute', 'audio', 'media', ['watch']],
    ['captions', 'Toggle captions', 'captions', 'media', ['watch'], 'once', { controlLabel: 'Captions', menuLabel: 'Toggle captions' }],
    ['description', 'Open video description', 'information', 'panel', ['watch'], 'once', { controlLabel: 'Description' }],
    ['comments', 'Open comments', 'information', 'panel', ['watch'], 'once', { controlLabel: 'Comments' }],
    ['channel', 'Open channel', 'information', 'channel', ['watch'], 'once', { controlLabel: 'Channel' }],
    ['like', 'Like / remove like', 'interaction', 'watchAction', ['watch'], 'once', { controlLabel: 'Like' }],
    ['dislike', 'Dislike / remove dislike', 'interaction', 'watchAction', ['watch'], 'once', { controlLabel: 'Dislike' }],
    ['subscribe', 'Subscribe / unsubscribe', 'interaction', 'watchAction', ['watch'], 'once', { controlLabel: 'Subscribe' }],
    ['save', 'Open playlists', 'interaction', 'watchAction', ['watch'], 'once', { controlLabel: 'Save to playlist' }],
    ['settings', 'Open player settings', 'page', 'settings', ['watch'], 'once', { controlLabel: 'Settings' }],
    ['search', 'Open search', 'page', 'menu', ['browse', 'watch', 'menu'], 'once', { menuLabel: 'Search videos' }],
    ['help', 'Toggle quick menu', 'page', 'menu', ['browse', 'watch', 'menu', 'search']],
    ['keyboardSymbols', 'Switch keyboard symbols', 'keyboard', 'searchKeyboard', ['search']],
    ['keyboardCandidates', 'Switch candidates / history', 'keyboard', 'searchKeyboard', ['search']],
    ['pause', 'Pause', 'internal', 'media', ['watch'], 'once', { internal: true }]
  ];
  const all = Object.freeze(definitions.map(([id, label, group, target, contexts, repeat = 'once', extra = {}]) => Object.freeze({
    id, label, group, target, contexts: Object.freeze(contexts), repeat, ...extra,
    ...(extra.parameter ? { parameter: Object.freeze(extra.parameter) } : {})
  })));
  const byId = Object.freeze(Object.fromEntries(all.map(action => [action.id, action])));
  window.YTGamepadActions = Object.freeze({ groups, all, byId,
    get: id => Object.hasOwn(byId, id) ? byId[id] : undefined,
    list: ({ group, context, includeInternal = false } = {}) => all.filter(action =>
      (includeInternal || !action.internal) && (!group || action.group === group) && (!context || action.contexts.includes(context)))
  });
})();
