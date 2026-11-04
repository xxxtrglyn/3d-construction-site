"""The approved Hard Hat Town palette (sRGB 0..1). Shared with the client via material names T_<key>.

Keep in sync with packages/client/src/render/palette.ts (checked by the exporter: it writes
assets/build/palette.json, which the client test compares).
"""

PALETTE = {
    'earth': (0.50, 0.33, 0.22), 'grass': (0.50, 0.78, 0.36), 'grass2': (0.38, 0.66, 0.30),
    'dirt': (0.86, 0.68, 0.46), 'mound': (0.66, 0.46, 0.30),
    'yellow': (1.0, 0.80, 0.18), 'orange': (1.0, 0.48, 0.12), 'beam': (0.92, 0.34, 0.24),
    'dark': (0.20, 0.20, 0.25), 'steel': (0.62, 0.65, 0.70), 'concrete': (0.80, 0.79, 0.76),
    'skin': (1.0, 0.82, 0.68), 'shirt': (0.34, 0.56, 0.90), 'jeans': (0.24, 0.32, 0.58),
    'boots': (0.45, 0.28, 0.16), 'white': (0.97, 0.97, 0.97), 'black': (0.06, 0.05, 0.08),
    'blush': (1.0, 0.55, 0.60), 'glass': (0.62, 0.88, 1.0), 'brick': (0.85, 0.38, 0.27),
    'brickwall': (0.84, 0.38, 0.27),
    'wood': (0.80, 0.60, 0.36), 'reflect': (0.88, 0.93, 0.97), 'rock': (0.60, 0.60, 0.62),
    'trunk': (0.55, 0.38, 0.24), 'leaf': (0.42, 0.74, 0.38),
    'cream': (0.99, 0.93, 0.80), 'teal': (0.22, 0.66, 0.70), 'stone': (0.70, 0.68, 0.66),
    'gold': (1.0, 0.78, 0.30), 'red': (0.92, 0.28, 0.30), 'pink': (1.0, 0.55, 0.72),
    'purple': (0.62, 0.45, 0.90), 'roofgray': (0.55, 0.57, 0.62), 'opening': (0.22, 0.18, 0.20),
    'hat': (1.0, 0.80, 0.18),
}


def lin(c):
    """sRGB -> linear (approximation used consistently with the reference renders)."""
    return tuple(x ** 2.2 for x in c)
