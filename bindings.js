// Standard Gamepad API positions shared by settings, input and prompt labels.
(() => {
  const defaults = Object.freeze({ confirm: 0, back: 1, playPause: 2, search: 3, seekBack: 4, seekForward: 5, volumeDown: 6, volumeUp: 7, help: 9, keyboardSymbols: 10, keyboardCandidates: 11 });
  const keys = Object.freeze({ 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3' });
  const labels = Object.freeze(Object.fromEntries(Object.keys(defaults).map(id => [id, window.YTGamepadActions.get(id).label])));
  function normalize(raw) {
    const result = {}, used = new Set();
    for (const action of Object.keys(defaults)) {
      const button = raw?.[action];
      if (Number.isInteger(button) && Object.hasOwn(keys, button) && !used.has(button)) { result[action] = button; used.add(button); }
    }
    for (const [action, fallback] of Object.entries(defaults)) {
      if (Object.hasOwn(result, action)) continue;
      const button = used.has(fallback) ? Object.keys(keys).map(Number).find(value => !used.has(value)) : fallback;
      result[action] = button; used.add(button);
    }
    return result;
  }
  // Legacy bindings seed both layouts until each has been customized.
  const layouts = Object.freeze({ watch: '播放页', browse: '主页' });
  function normalizeLayouts(raw, legacy) {
    return Object.fromEntries(Object.keys(layouts).map(id => [id, normalize(raw?.[id] ?? legacy)]));
  }
  function contextLabel(action, layout) {
    if (layout === 'browse') {
      const browseLabels = { confirm: '打开 / 选择', back: '返回 / 关闭', search: '搜索视频', help: '快捷菜单', seekBack: '上一个分类', seekForward: '下一个分类', playPause: '播放 / 暂停（搜索时删除）', volumeDown: '搜索时切换大小写', volumeUp: '搜索时提交' };
      return browseLabels[action] || labels[action];
    }
    const watchLabels = { confirm: '确认 / 选择', back: '返回 / 关闭', playPause: '播放 / 暂停', search: '搜索视频', seekBack: '后退 10 秒', seekForward: '快进 10 秒', volumeDown: '降低音量', volumeUp: '提高音量', help: '快捷菜单' };
    return watchLabels[action] || labels[action];
  }
  window.YTGamepadBindings = { defaults, keys, labels, normalize, layouts, normalizeLayouts, contextLabel };
})();
