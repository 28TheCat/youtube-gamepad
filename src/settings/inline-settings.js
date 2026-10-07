// Runs in the extension's isolated world. Storage writes come from these UI
// handlers, never from a page message containing arbitrary keys or values.
(() => {
  window.YTGamepadInlineSettings = {
    mount(root, container) {
      const schema = window.YTGamepadBindings;
      const defaults = { enabled: true, theater: true, autoFullscreen: null, deadzone: .35, repeatDelay: 350, repeatInterval: 140, bindings: {}, bindingLayouts: null };
      let values, category = '', bindingAction = '', layout = location.pathname === '/watch' ? 'watch' : 'browse', saving = false, disposed = false;
      const currentBindings = () => values.bindingLayouts[layout];
      const bindingUpdate = next => {
        const bindingLayouts = { ...values.bindingLayouts, [layout]: next };
        return { bindingLayouts, bindings: bindingLayouts.watch };
      };
      const message = root.querySelector('#message');
      const feedback = text => { if (!disposed) message.textContent = text; };
      const node = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text) element.textContent = text;
        if (className) element.className = className;
        return element;
      };
      const button = (text, action, id) => {
        const element = node('button', text); element.type = 'button';
        if (id) element.dataset.setting = id;
        element.disabled = saving;
        element.addEventListener('click', action); container.append(element); return element;
      };
      const physicalNames = { A: 'A / × · Bottom', B: 'B / ○ · Right', X: 'X / □ · Left', Y: 'Y / △ · Top', LB: 'LB / L1', RB: 'RB / R1', LT: 'LT / L2', RT: 'RT / R2', Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'Left stick press', R3: 'Right stick press' };
      function badge(element, key) {
        const icon = node('span', key);
        // Mark physical keys directly, bypassing action prompt remapping.
        const family = document.documentElement.dataset.ytgController || 'generic';
        icon.dataset.ytgFamily = family; icon.dataset.ytgFirstKey = key;
        icon.dataset.ytgSecondKey = key; icon.dataset.ytgIcon = 'true';
        icon.dataset.inlineKey = key; icon.setAttribute('aria-hidden', 'true');
        element.prepend(icon); element.classList.add('inline-binding-button');
      }
      function render(focusId) {
        if (disposed || !container.isConnected) return;
        container.replaceChildren();
        if (!values) { container.append(node('p', 'Loading settings…')); return; }
        const labels = { general: 'General', display: 'Display & layout', controller: 'Gamepad & buttons', help: 'Help & diagnostics' };
        if (!category) {
          container.append(node('p', 'Changes save automatically and apply to your open YouTube tabs.'));
          for (const [key, label] of Object.entries(labels)) button(label, () => { category = key; render(); }, key);
        } else {
          container.append(node('h3', bindingAction ? schema.labels[bindingAction] : labels[category]));
          if (category === 'general') {
            const toggle = button(`Enable gamepad controls · ${values.enabled ? 'On' : 'Off'}`, () => save({ enabled: !values.enabled }, 'enabled'), 'enabled');
            toggle.setAttribute('aria-pressed', String(values.enabled));
            container.append(node('p', 'Turning controls off closes this menu. Use the extension toolbar button to turn them on again.'));
          }
          if (category === 'display') {
            for (const [key, label] of [['theater', 'TV layout'], ['autoFullscreen', 'Enter fullscreen when a gamepad is detected']]) {
              const toggle = button(`${label} · ${values[key] ? 'On' : 'Off'}`, () => save({ [key]: !values[key] }, key), key);
              toggle.setAttribute('aria-pressed', String(values[key]));
            }
            container.append(node('p', 'TV layout and browser fullscreen work independently. Manual fullscreen stays under your control.'));
          }
          if (category === 'controller' && !bindingAction) {
            const tabs = node('div', '', 'inline-layout-tabs');
            for (const [id, label] of Object.entries(schema.layouts)) {
              const tab = button(label, () => { layout = id; render(`layout-${id}`); }, `layout-${id}`);
              tab.setAttribute('aria-pressed', String(layout === id)); tabs.append(tab);
            }
            container.append(tabs);
            container.append(node('p', '两套布局独立保存，进入对应页面时自动切换。选择功能后修改按键，已使用的按键会交换功能。'));
            const diagram = node('div', '', 'inline-controller-map');
            diagram.setAttribute('role', 'group'); diagram.setAttribute('aria-label', `${schema.layouts[layout]}手柄布局`);
            const padPositions = { A: [74.5, 46.75], B: [81, 37], X: [68, 37], Y: [74.5, 27.25], LB: [24, 16], RB: [76, 16], LT: [16, 7], RT: [84, 7], Select: [43.2, 36.5], Start: [56.8, 36.5], L3: [26.3, 36.5], R3: [63, 57.5] };
            for (const [key, [x, y]] of Object.entries(padPositions)) {
              const action = Object.keys(currentBindings()).find(id => schema.keys[currentBindings()[id]] === key);
              if (!action) continue;
              const control = button(key, () => { bindingAction = action; render(); }, `pad-${key}`);
              control.className = 'inline-pad-key'; control.style.left = `${x}%`; control.style.top = `${y}%`;
              control.setAttribute('aria-label', `${key} · ${schema.contextLabel(action, layout)}`);
              control.title = control.getAttribute('aria-label'); diagram.append(control);
            }
            container.append(diagram);
            for (const [action, label] of Object.entries(schema.labels)) {
              const key = schema.keys[currentBindings()[action]];
              const control = button(`${schema.contextLabel(action, layout)} · ${physicalNames[key]}`, () => { bindingAction = action; render(); }, action);
              badge(control, key);
            }
            button('Restore default bindings', () => save(bindingUpdate({ ...schema.defaults }), 'resetBindings'), 'resetBindings');
            container.append(node('h3', 'Input sensitivity'));
            for (const [key, label, min, max, step, suffix] of [
              ['deadzone', 'Stick deadzone', .15, .75, .05, ''],
              ['repeatDelay', 'Initial repeat delay', 150, 1000, 10, ' ms'],
              ['repeatInterval', 'Repeat interval', 80, 500, 10, ' ms']
            ]) {
              const row = node('div', '', 'inline-adjustment');
              const labelNode = node('span', `${label} · ${values[key]}${suffix}`); row.append(labelNode);
              for (const [delta, text] of [[-step, '−'], [step, '+']]) {
                const adjust = button(text, () => save({ [key]: Math.round(Math.min(max, Math.max(min, values[key] + delta)) * 100) / 100 }, `${key}-${text}`), `${key}-${text}`);
                adjust.setAttribute('aria-label', `${delta < 0 ? 'Decrease' : 'Increase'} ${label}`);
                adjust.disabled = saving || (delta < 0 ? values[key] <= min : values[key] >= max);
                row.append(adjust);
              }
              container.append(row);
            }
          } else if (category === 'controller') {
            container.append(node('p', 'Names show Xbox / PlayStation equivalents by physical position; Switch letters differ.'));
            for (const [index, key] of Object.entries(schema.keys)) {
              const choice = button(physicalNames[key], () => {
                const next = { ...currentBindings() }, previous = next[bindingAction];
                const conflict = Object.keys(next).find(action => action !== bindingAction && next[action] === Number(index));
                if (conflict) next[conflict] = previous;
                next[bindingAction] = Number(index);
                save(bindingUpdate(next), index, conflict ? `Saved. Swapped buttons with “${schema.labels[conflict]}”.` : 'Button bindings saved.');
              }, index);
              choice.setAttribute('aria-pressed', String(currentBindings()[bindingAction] === Number(index)));
              badge(choice, key);
            }
          }
          if (category === 'help') {
            container.append(node('p', 'Connect a standard-layout gamepad, click YouTube, then press a gamepad button. The D-pad and left stick navigate; the bottom button confirms.'));
            container.append(node('p', 'During search, Play / pause deletes, Rewind / Forward moves the cursor, and Volume down / up changes letter case / submits.'));
            button('Export diagnostics JSON', exportDiagnostics, 'exportDiagnostics');
            button('Clear diagnostic records', async () => {
              try {
                const result = await chrome.runtime.sendMessage({ type: 'ytg-clear-inline-diagnostics' });
                feedback(result?.ok ? 'Diagnostic records cleared.' : 'Could not clear records. Please try again.');
              } catch (_) { feedback('Could not clear records. Please try again.'); }
            }, 'clearDiagnostics');
          }
          const back = button(bindingAction ? 'Back to gamepad settings' : 'Back to settings', () => {
            const previous = bindingAction || category;
            if (bindingAction) bindingAction = ''; else category = '';
            render(previous);
          });
          back.dataset.inlineBack = 'true';
        }
        const target = [...container.querySelectorAll('button')].find(control => control.dataset.setting === focusId && !control.disabled)
          || container.querySelector('button:not(:disabled)');
        target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
      }
      async function save(next, focusId, text = 'Settings saved.') {
        if (disposed || saving) return;
        saving = true; render(focusId);
        try {
          await chrome.storage.local.set(next);
          if (disposed) return;
          values = { ...values, ...next }; feedback(text);
        } catch (_) { feedback('Could not save settings. Please try again.'); }
        finally { saving = false; render(focusId); }
      }
      async function exportDiagnostics() {
        let url;
        try {
          const store = globalThis.YTGamepadDiagnosticStore;
          const saved = await chrome.storage.local.get(store.key);
          const entries = store.bounded(saved[store.key]);
          const report = { formatVersion: 1, extensionVersion: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), entries };
          url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
          const link = node('a'); link.href = url; link.download = 'youtube-gamepad-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.append(link); link.click(); link.remove(); feedback(`Exported ${entries.length} records.`);
        } catch (_) { feedback('Export failed. Please try again.'); }
        finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
      }
      function apply(stored) {
        values = { ...defaults, bindings: schema.normalize(stored.bindings), bindingLayouts: schema.normalizeLayouts(stored.bindingLayouts, stored.bindings) };
        for (const key of ['enabled', 'theater']) values[key] = typeof stored[key] === 'boolean' ? stored[key] : defaults[key];
        values.autoFullscreen = typeof stored.autoFullscreen === 'boolean' ? stored.autoFullscreen : values.theater;
        for (const [key, min, max] of [['deadzone', .15, .75], ['repeatDelay', 150, 1000], ['repeatInterval', 80, 500]]) {
          values[key] = typeof stored[key] === 'number' && Number.isFinite(stored[key]) ? Math.min(max, Math.max(min, stored[key])) : defaults[key];
        }
      }
      const changed = (changes, area) => {
        if (area !== 'local' || !values || disposed) return;
        const updates = Object.fromEntries(Object.entries(changes).filter(([key]) => key in defaults).map(([key, change]) => [key, change.newValue ?? defaults[key]]));
        if (!Object.keys(updates).length) return;
        const focusId = root.activeElement?.dataset.setting;
        apply({ ...values, ...updates }); render(focusId);
      };
      chrome.storage.onChanged.addListener(changed);
      const controllerObserver = new MutationObserver(() => render(root.activeElement?.dataset.setting));
      controllerObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-controller'] });
      chrome.storage.local.get(defaults).then(stored => {
        if (!disposed) { apply(stored); render(); }
      }).catch(() => feedback('Could not load settings. Close and reopen this menu to retry.'));
      render();
      return () => { disposed = true; controllerObserver.disconnect(); chrome.storage.onChanged.removeListener(changed); };
    }
  };
})();
