(() => {
  const schema = window.YTGamepadBindings, prompts = window.YTGamepadControllerStyle;
  const container = document.getElementById('bindingFields'), reset = document.getElementById('resetBindings');
  const status = document.getElementById('status'), selects = {};
  const feedback = (text, success = false) => {
    if (window.YTGamepadSettingsFeedback) window.YTGamepadSettingsFeedback(text, success);
    else status.textContent = text;
  };
  const physicalLabels = { A: 'A / × · Bottom', B: 'B / ○ · Right', X: 'X / □ · Left', Y: 'Y / △ · Top', LB: 'LB / L1', RB: 'RB / R1', LT: 'LT / L2', RT: 'RT / R2', Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'L3 · Left stick press', R3: 'R3 · Right stick press' };
  // Use the same unmodified Kenney artwork as the playback prompts. These
  // represent physical buttons, so action remapping must not affect the icons.
  const physicalIcons = {
    A: ['xbox_button_color_a', 'playstation_button_color_cross'],
    B: ['xbox_button_color_b', 'playstation_button_color_circle'],
    X: ['xbox_button_color_x', 'playstation_button_color_square'],
    Y: ['xbox_button_color_y', 'playstation_button_color_triangle'],
    LB: ['xbox_lb', 'playstation_trigger_l1'], RB: ['xbox_rb', 'playstation_trigger_r1'],
    LT: ['xbox_lt', 'playstation_trigger_l2'], RT: ['xbox_rt', 'playstation_trigger_r2'],
    Start: ['xbox_button_menu', 'playstation4_button_options'],
    Select: ['xbox_button_view', 'playstation4_button_share'],
    L3: ['xbox_stick_l_press', 'playstation_stick_l_press'],
    R3: ['xbox_stick_r_press', 'playstation_stick_r_press']
  };
  const positions = { A: 'Bottom', B: 'Right', X: 'Left', Y: 'Top', LB: 'Left bumper', RB: 'Right bumper', LT: 'Left trigger', RT: 'Right trigger', Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'Left stick press', R3: 'Right stick press' };
  let layouts = schema.normalizeLayouts(), layout = 'watch', values = layouts.watch, ready = false, saving = false;
  const tabs = [...document.querySelectorAll('[data-binding-layout]')], copies = {}, hotspots = {};
  const positionsOnPad = { A: [74.5, 46.75], B: [81, 37], X: [68, 37], Y: [74.5, 27.25], LB: [24, 16], RB: [76, 16], LT: [16, 7], RT: [84, 7], Select: [43.2, 36.5], Start: [56.8, 36.5], L3: [26.3, 36.5], R3: [63, 57.5] };
  for (const [key, [x, y]] of Object.entries(positionsOnPad)) {
    const hotspot = document.createElement('button'); hotspot.type = 'button'; hotspot.className = 'controller-hotspot'; hotspot.dataset.key = key;
    hotspot.style.left = `${x}%`; hotspot.style.top = `${y}%`; hotspot.textContent = key;
    hotspot.addEventListener('click', () => {
      const action = Object.keys(values).find(id => schema.keys[values[id]] === key);
      if (!action) return;
      const select = selects[action], details = select.closest('details');
      if (details) details.open = true;
      select.focus(); select.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (select.showPicker) { try { select.showPicker(); } catch (_) {} }
    });
    hotspots[key] = hotspot; document.getElementById('controllerHotspots').append(hotspot);
  }
  function render() {
    values = layouts[layout];
    for (const [action, select] of Object.entries(selects)) {
      select.value = String(values[action]);
      copies[action].firstChild.textContent = schema.contextLabel(action, layout);
    }
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.bindingLayout === layout));
    for (const [key, hotspot] of Object.entries(hotspots)) {
      const action = Object.keys(values).find(id => schema.keys[values[id]] === key);
      hotspot.disabled = saving || !ready || !action;
      hotspot.setAttribute('aria-label', `${key} · ${action ? schema.contextLabel(action, layout) : '未分配'}`);
      hotspot.title = hotspot.getAttribute('aria-label');
    }
    document.getElementById('controllerCaption').textContent = `${schema.layouts[layout]}布局`;
    prompts.configureBindings(values);
  }
  function busy(value) {
    saving = value; reset.disabled = value || !ready;
    for (const tab of tabs) tab.disabled = value || !ready;
    render();
    for (const select of Object.values(selects)) select.disabled = value || !ready;
  }
  async function save(next, message) {
    if (!ready || saving) return;
    busy(true);
    try {
      const nextLayouts = { ...layouts, [layout]: next };
      await chrome.storage.local.set({ bindingLayouts: nextLayouts, bindings: nextLayouts.watch });
      layouts = nextLayouts; render(); feedback(message, true);
    } catch (_) { render(); feedback('Could not save bindings. Please try again.'); }
    finally { busy(false); }
  }
  for (const [action, label] of Object.entries(schema.labels)) {
    const row = document.createElement('div'); row.className = 'binding-row';
    const copy = document.createElement('label'); copy.htmlFor = `binding-${action}`; copy.textContent = label;
    copies[action] = copy;
    const keyboard = window.YTGamepadActions.get(action).group === 'keyboard';
    if (keyboard) {
      const note = document.createElement('span'); note.className = 'binding-context'; note.textContent = 'Search keyboard'; copy.append(note);
    }
    const select = document.createElement('select'); select.id = copy.htmlFor; select.disabled = true;
    const selectedButton = document.createElement('button'); selectedButton.type = 'button';
    selectedButton.append(document.createElement('selectedcontent')); select.append(selectedButton);
    for (const [button, key] of Object.entries(schema.keys)) {
      const option = document.createElement('option'); option.value = button;
      // Physical labels must not be remapped again by the action prompt formatter.
      if (physicalIcons[key]) {
        const icons = document.createElement('span'); icons.className = 'binding-icons'; icons.setAttribute('aria-hidden', 'true');
        for (const name of physicalIcons[key]) {
          const icon = document.createElement('img'); icon.src = `assets/controller/${name}.svg`; icon.alt = ''; icon.width = 28; icon.height = 28;
          icons.append(icon);
        }
        const name = document.createElement('span'); name.className = 'binding-button-name'; name.textContent = physicalLabels[key];
        const position = document.createElement('span'); position.className = 'binding-position'; position.setAttribute('aria-hidden', 'true'); position.textContent = positions[key];
        option.append(icons, name, position);
      } else option.textContent = physicalLabels[key];
      select.append(option);
    }
    select.addEventListener('change', () => {
      const button = Number(select.value), next = { ...values, [action]: button };
      const conflict = Object.keys(values).find(other => other !== action && values[other] === button);
      if (conflict) next[conflict] = values[action];
      save(next, conflict ? `Saved. Swapped buttons with “${schema.labels[conflict]}”` : 'Button bindings saved');
    });
    select.addEventListener('focus', () => {
      for (const [key, hotspot] of Object.entries(hotspots)) hotspot.classList.toggle('is-active', schema.keys[values[action]] === key);
    });
    select.addEventListener('blur', () => { for (const hotspot of Object.values(hotspots)) hotspot.classList.remove('is-active'); });
    selects[action] = select; row.append(copy, select);
    const target = keyboard ? container : document.getElementById(['seekBack', 'seekForward', 'volumeDown', 'volumeUp'].includes(action) ? 'bindingLeft' : action === 'help' ? 'bindingBottom' : 'bindingRight');
    target.append(row);
  }
  for (const tab of tabs) tab.addEventListener('click', () => { if (saving || !ready) return; layout = tab.dataset.bindingLayout; render(); });
  reset.addEventListener('click', () => save({ ...schema.defaults }, 'Default bindings restored'));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !ready || (!changes.bindings && !changes.bindingLayouts)) return;
    chrome.storage.local.get({ bindings: {}, bindingLayouts: null }).then(stored => {
      layouts = schema.normalizeLayouts(stored.bindingLayouts, stored.bindings); render();
    }).catch(() => feedback('Could not reload bindings. Please reopen this page.'));
  });
  chrome.storage.local.get({ bindings: {}, bindingLayouts: null }).then(stored => {
    layouts = schema.normalizeLayouts(stored.bindingLayouts, stored.bindings); ready = true; render(); busy(false);
  }).catch(() => { feedback('Could not load bindings. Please reopen this page.'); });
})();
