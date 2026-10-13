"""Extract unchanged outlines from bundled wiliwili fonts. Requires fontTools.
SVG data URLs work inside Shadow DOM without document-wide font registration.
"""
from pathlib import Path
from hashlib import sha256
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parent.parent
directory = root / 'assets/controller/controller-font'
revision = (directory / 'upstream-revision.txt').read_text().strip()
mapping = dict(A=0xE0A0, B=0xE0A1, X=0xE0A2, Y=0xE0A3,
               LB=0xE0A4, RB=0xE0A5, LT=0xE0A6, RT=0xE0A7,
               L3=0xE0C4, R3=0xE0C5, Start=0xE0EF, Select=0xE0F0)
manifest = {'source': 'https://github.com/xfangfang/wiliwili', 'revision': revision,
            'author': 'Dean Tersigni; modified by wiliwili',
            'license': 'Freeware; see licenses/controller-font-FREEWARE.txt',
            'profiles': {}, 'files': {}}
for family, name in [('xbox', 'keymap_xbox.ttf'), ('playstation', 'keymap_ps.ttf')]:
    font_path = directory / name
    font = TTFont(font_path)
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    source = f'https://github.com/xfangfang/wiliwili/blob/{revision}/resources/font/{name}'
    manifest['files'][font_path.relative_to(root).as_posix()] = {
        'sha256': sha256(font_path.read_bytes()).hexdigest(), 'source': source}
    manifest['profiles'][family] = {}
    for key, code in mapping.items():
        glyph = glyphs[cmap[code]]
        bounds = BoundsPen(glyphs)
        glyph.draw(bounds)
        x0, y0, x1, y1 = bounds.bounds
        scale = 48 / max(x1 - x0, y1 - y0)
        tx, ty = 32 - scale * (x0 + x1) / 2, 32 + scale * (y0 + y1) / 2
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
               f'<path fill="#fff" transform="matrix({scale:g} 0 0 {-scale:g} {tx:g} {ty:g})" '
               f'd="{pen.getCommands()}"/></svg>\n')
        path = directory / f'{family}-{key.lower()}.svg'
        path.write_text(svg, encoding='utf-8', newline='\n')
        relative = path.relative_to(root).as_posix()
        manifest['profiles'][family][key] = relative
        manifest['files'][relative] = {'sha256': sha256(path.read_bytes()).hexdigest(),
                                      'source': source, 'codepoint': f'U+{code:04X}'}
(directory / 'prompts.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
