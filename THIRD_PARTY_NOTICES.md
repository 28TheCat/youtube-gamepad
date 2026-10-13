# Bundled runtime libraries

Vue 3 and its runtime packages are licensed under MIT, copyright (c) 2018-present Yuxi (Evan) You. The license is included in `licenses/vue-LICENSE.txt`.

Pinia is licensed under MIT, copyright (c) 2019-present Eduardo San Martin Morote. The license is included in `licenses/pinia-LICENSE.txt`.

These libraries are bundled locally. Their versions are locked in `package-lock.json`; no remote runtime scripts are loaded.

# CC-CEDICT dictionary

Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
Community maintained by CC-CEDICT contributors, published by MDBG. Referenced work: CEDICT, Copyright (C) 1997, 1998 Paul Andrew Denisowski.

Snapshot: 2026-10-01T23:26:37Z; downloaded 2026-10-03.
License stated in the downloaded dictionary: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/ .

`pinyin-data.js` is a derived dictionary under the same license. Changes: retain simplified Chinese words and untoned lowercase pinyin, map u: to v, remove duplicate entries and definitions, omit mixed-alphabet words and readings longer than 48 letters. Attribution and license must accompany redistribution of this derived data. This data license does not change the license of independently written extension code.

## Google Material Icons

Copyright Google LLC. Source: https://github.com/google/material-design-icons/blob/master/src/content/backspace/materialicons/24px.svg . Licensed under Apache License 2.0. The backspace icon path is embedded locally in search.js and uses currentColor for theme matching.

Playback and search language icons use unmodified filled paths from Google Material Icons, upstream revision `737e3324305806514d7909874fa1818ae1808232`. Paths are embedded locally in `ui/watch-view.js` and `search.js`; transparent viewport paths are omitted, display size is controlled by CSS, and fill uses `currentColor`. No external fonts or runtime icon downloads are used. Apache-2.0 license text is included in `licenses/material-icons-LICENSE.txt`.

- previous: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/av/replay_10/materialicons/24px.svg
- next: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/av/forward_10/materialicons/24px.svg
- pause: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/av/pause/materialicons/24px.svg
- play: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/av/play_arrow/materialicons/24px.svg
- captions: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/av/closed_caption/materialicons/24px.svg
- settings: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/action/settings/materialicons/24px.svg
- like: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/action/thumb_up/materialicons/24px.svg
- dislike: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/action/thumb_down/materialicons/24px.svg
- comments: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/communication/comment/materialicons/24px.svg
- save: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/action/bookmark_border/materialicons/24px.svg
- language: https://github.com/google/material-design-icons/blob/737e3324305806514d7909874fa1818ae1808232/src/action/language/materialicons/24px.svg

## Kenney Input Prompts

Author: Kenney (https://kenney.nl). Source: https://kenney.nl/assets/input-prompts . Package version: 1.5A, downloaded 2026-10-04. License: Creative Commons Zero (CC0 1.0), https://creativecommons.org/publicdomain/zero/1.0/ . The original package license is included in `licenses/kenney-input-prompts-LICENSE.txt`.

`assets/controller/` retains the original SVG files and `kenney.json` records their original paths and SHA-256 hashes. Switch prompts and direction icons still use these assets. These are third-party Kenney assets, not manufacturer-provided artwork.

## Controller Font

Source: https://github.com/xfangfang/wiliwili/tree/yoga/resources/font . The pinned upstream revision is in `assets/controller/controller-font/upstream-revision.txt`.

Xbox and PlayStation fonts were modified by wiliwili from Controller Font by Dean Tersigni, copyright 2020, described upstream as freeware. The original notice is retained in `licenses/controller-font-FREEWARE.txt` and alongside the original fonts. The keyboard font is also retained as a reusable asset; the current UI continues to display keyboard labels as text.

`scripts/extract-controller-glyphs.py` extracts the original Xbox/PS glyph outlines into 64×64 SVGs, centering and scaling them with white fill. These locally embedded images replace Xbox/PS button prompts, including the generic Xbox fallback. No font download is required at runtime. `prompts.json` records source URLs, codepoints and SHA-256 hashes. Switch retains Kenney artwork because upstream `switch_icons.ttf` is an empty placeholder.
