"""Replace hard-coded colors, font sizes and z-index values with design tokens.

Property-aware: the same hex becomes a surface, text, border, action or status
token depending on where it is used. Shadows and gradients keep their shape but
use token colors. Run once per file list; prints a summary per file.
"""
import re
import sys
from pathlib import Path

HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b')
DECL = re.compile(r'(?P<prop>[a-z-]+)\s*:\s*(?P<value>[^;{}]+)')


def parse(h):
    h = h.lower()
    if len(h) in (3, 4):
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def luminance(r, g, b):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
    return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b)


def hue(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return None, 0
    sat = (mx - mn) / mx
    if mx == r:
        h = ((g - b) / (mx - mn)) % 6
    elif mx == g:
        h = (b - r) / (mx - mn) + 2
    else:
        h = (r - g) / (mx - mn) + 4
    return h * 60, sat


def token(prop, h):
    """Map a color from Braand's original DARK palette to a semantic token."""
    r, g, b, a = parse(h)
    hu, sat = hue(r, g, b)
    lum = luminance(r, g, b)
    background = 'background' in prop
    if a < .7:
        if lum < .05:  # translucent black: scrims and shadows
            return 'var(--color-overlay)' if background else 'rgba(0, 0, 0, .2)'
        if background:
            return 'var(--color-fill-hover)' if a > .14 else 'var(--color-fill)'
        if prop == 'color':
            return 'var(--color-text-subtle)'
        return 'var(--color-border-strong)' if a > .18 else 'var(--color-border)'
    if hu is not None and sat > .35:
        if hu < 20 or hu >= 330:
            return 'var(--color-danger-soft)' if background else 'var(--color-danger)'
        if hu < 55:
            return 'var(--color-warning-soft)' if background else 'var(--color-warning)'
        if hu < 170:
            return 'var(--color-success-soft)' if background else 'var(--color-success)'
        if hu < 300:
            if background:
                return 'var(--color-info-soft)' if lum > .45 else 'var(--color-action)'
            return 'var(--color-link)' if prop == 'color' else 'var(--color-accent)'
    if prop in ('color', 'fill', 'stroke', 'caret-color'):
        if lum > .6:
            return 'var(--color-text)'
        if lum > .25:
            return 'var(--color-text-muted)'
        if lum > .1:
            return 'var(--color-text-subtle)'
        return 'var(--color-bg)'  # dark text sits on an inverted (light) surface
    if 'border' in prop or 'outline' in prop:
        return 'var(--color-border-strong)' if lum > .06 else 'var(--color-border)'
    if 'shadow' in prop:
        return 'rgba(0, 0, 0, .2)'
    if lum > .6:
        return 'var(--color-text)'  # inverted surface (light chip on dark UI)
    if lum < .009:
        return 'var(--color-bg)'
    if lum < .02:
        return 'var(--color-surface)'
    if lum < .04:
        return 'var(--color-surface-2)'
    return 'var(--color-surface-3)'


SIZES = [(12, 'var(--text-xs)'), (14, 'var(--text-sm)'), (15, 'var(--text-base)'), (18, 'var(--text-lg)'), (22, 'var(--text-xl)'), (28, 'var(--text-2xl)'), (36, 'var(--text-3xl)')]
Z = [(1, 'var(--z-raised)'), (20, 'var(--z-sticky)'), (30, 'var(--z-sidebar)'), (45, 'var(--z-dropdown)'), (60, 'var(--z-overlay)'), (80, 'var(--z-modal)'), (100, 'var(--z-toast)'), (200, 'var(--z-tooltip)')]


def size_token(px):
    if px < 11.5:
        return None  # micro labels keep their value
    return min(SIZES, key=lambda item: abs(item[0] - px))[1]


def z_token(n):
    if n <= 0:
        return None
    return min(Z, key=lambda item: abs(item[0] - n))[1]


def convert(text):
    counts = {'color': 0, 'font-size': 0, 'z-index': 0}

    def decl(match):
        prop, value = match.group('prop'), match.group('value')
        if prop.startswith('--'):
            return match.group(0)
        original = value
        if HEX.search(value):
            value = HEX.sub(lambda m: token(prop, m.group(1)), value)
            counts['color'] += len(HEX.findall(original))
        if prop == 'font-size':
            m = re.fullmatch(r'\s*(\d+(?:\.\d+)?)px(\s*!important)?\s*', value)
            if m and size_token(float(m.group(1))):
                value = size_token(float(m.group(1))) + (m.group(2) or '')
                counts['font-size'] += 1
        if prop == 'z-index':
            m = re.fullmatch(r'\s*(\d+)(\s*!important)?\s*', value)
            if m and z_token(int(m.group(1))):
                value = z_token(int(m.group(1))) + (m.group(2) or '')
                counts['z-index'] += 1
        return match.group(0).replace(original, value, 1) if value != original else match.group(0)

    return DECL.sub(decl, text), counts


if __name__ == '__main__':
    for name in sys.argv[1:]:
        path = Path(name)
        new, counts = convert(path.read_text(encoding='utf-8'))
        path.write_text(new, encoding='utf-8')
        print(name, counts)
