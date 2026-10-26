# Bundled runtime libraries

Vue 3 and its runtime packages are licensed under MIT, copyright (c) 2018-present Yuxi (Evan) You. The license is included in `licenses/vue-LICENSE.txt`.

Pinia is licensed under MIT, copyright (c) 2019-present Eduardo San Martin Morote. The license is included in `licenses/pinia-LICENSE.txt`.

These libraries are bundled locally. Their versions are locked in `package-lock.json`; no remote runtime scripts are loaded.

## YouTube.js search adapter

YouTube.js (`youtubei.js`) 18.1.0, https://github.com/LuanRT/YouTube.js, is bundled locally under MIT, copyright (c) 2021 LuanRT. Its license is included in `licenses/youtubei-LICENSE.txt`. The search adapter uses the existing page request service and does not download or evaluate remote player code.

Bundled transitive dependencies include fflate 0.8.3 (MIT, `licenses/fflate-LICENSE.txt`), meriyah 7.4.0 (ISC, `licenses/meriyah-LICENSE.txt`), and @bufbuild/protobuf 2.16.0 (Apache-2.0 AND BSD-3-Clause, `licenses/protobuf-LICENSE.txt` and `licenses/protobuf-BSD-LICENSE.txt`). Versions are locked in `package-lock.json`.

# CC-CEDICT dictionary


Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
Community maintained by CC-CEDICT contributors, published by MDBG. Referenced work: CEDICT, Copyright (C) 1997, 1998 Paul Andrew Denisowski.

Snapshot: 2026-10-01T23:26:37Z; downloaded 2026-10-03.
License stated in the downloaded dictionary: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/ .

`pinyin-data.js` is a derived dictionary under the same license. Changes: retain simplified Chinese words and untoned lowercase pinyin, map u: to v, remove duplicate entries and definitions, omit mixed-alphabet words and readings longer than 48 letters. Attribution and license must accompany redistribution of this derived data. This data license does not change the license of independently written extension code.

## MingCute interface icons

Source: https://github.com/Richard9394/MingCute . Upstream revision: `ca98bb55513a22ff0dab713aaf7870b512944653`. Licensed under Apache License 2.0; the original license is included in `licenses/mingcute-LICENSE.txt`.

Navigation, search, settings, on-screen keyboard and playback controls use MingCute regular (line) and filled (fill) icons. `scripts/extract-mingcute.py` extracts a finite selection of original SVG shapes into `src/ui/mingcute-icons.ts`, preserving geometry and replacing fixed colors with `currentColor`. `InterfaceIcon.vue` constructs SVG elements locally without external fonts, runtime downloads or HTML-string injection. Active navigation entries and enabled playback toggles use filled variants. Brand artwork, account photos and controller prompts retain their separate sources.

## Google Material Icons

Subscription controls use Google Material Icons `social/notifications`, `social/notifications_active`, `social/notifications_off`, and `navigation/expand_more` (outlined and filled), from revision `737e3324305806514d7909874fa1818ae1808232`. Original SVG geometry is preserved; colors follow `currentColor`. Licensed under Apache-2.0, included in `licenses/material-icons-LICENSE.txt`. Source: https://github.com/google/material-design-icons .

Channel verification uses Google's `action/check_circle` icon; official artist channels use `image/music_note`, from revision `737e3324305806514d7909874fa1818ae1808232`, under the included Apache-2.0 license. Original SVG geometry is preserved by `scripts/extract-mingcute.py`.

The sidebar subscription entry uses Google's outlined and filled `subscriptions` icons (stacked video cards with a play symbol), upstream revision `737e3324305806514d7909874fa1818ae1808232`. Original SVG geometry is preserved in `src/ui/mingcute-icons.ts`; fill follows `currentColor`. Sources: https://github.com/google/material-design-icons/tree/737e3324305806514d7909874fa1818ae1808232/src/av/subscriptions . The Apache-2.0 license is included in `licenses/material-icons-LICENSE.txt`.

Copyright Google LLC. Source: https://github.com/google/material-design-icons/blob/master/src/content/backspace/materialicons/24px.svg . Licensed under Apache License 2.0. The legacy search test fixture embeds the backspace icon path with currentColor for theme matching.

Legacy playback and search test fixtures retain filled paths from Google Material Icons, upstream revision `737e3324305806514d7909874fa1818ae1808232`. Production Vue interface icons now use MingCute. Apache-2.0 license text is included in `licenses/material-icons-LICENSE.txt`.

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

`assets/controller/` retains the original SVG files and `kenney.json` records their original paths and SHA-256 hashes. All Xbox, PlayStation, Switch and generic controller prompts use these assets. These are third-party Kenney assets, not manufacturer-provided artwork. Face buttons retain their original colors; white glyphs follow the interface text color through CSS masks.

## Generic Gamepad Template

Author: nicefrog. Source: https://opengameart.org/content/generic-gamepad-template . License: CC0 1.0; see `licenses/nicefrog-gamepad-LICENSE.txt`.

`assets/controller/layout.svg` is the original SVG downloaded from https://opengameart.org/sites/default/files/controller.svg . `assets/controller/template.json` records its source and SHA-256 hash. Geometry remains unchanged. CSS scales it and adjusts its appearance on the binding overview. Hotspots align with the template's symmetric stick layout. The author describes the artwork as referencing a Logitech F310; it is a generic illustration, not manufacturer-provided artwork.
