from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import json, math, re

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public' / 'images' / 'product-mockups' / 'highland-vial-label-template.png'
OUT = ROOT / 'public' / 'images' / 'product-mockups' / 'generated'
DATA = ROOT / 'data' / 'products.json'
OUT.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    Path('C:/Windows/Fonts/arialbd.ttf'),
    Path('C:/Windows/Fonts/Arialbd.ttf'),
    Path('C:/Windows/Fonts/segoeuib.ttf'),
    Path('C:/Windows/Fonts/seguisb.ttf'),
]
FONT_REGULAR_CANDIDATES = [
    Path('C:/Windows/Fonts/arial.ttf'),
    Path('C:/Windows/Fonts/segoeui.ttf'),
]
FONT_BOLD = next((p for p in FONT_CANDIDATES if p.exists()), None)
FONT_REG = next((p for p in FONT_REGULAR_CANDIDATES if p.exists()), FONT_BOLD)

ALIASES = {
    'BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)': 'KLOW BLEND',
    'BPC-157 + GHK-Cu + TB-500 Blend (Glow)': 'GLOW BLEND',
    'BPC-157 + TB-500 Blend': 'BPC + TB-500',
    'Bacteriostatic Water': 'BAC WATER',
    'CJC-1295 without DAC + Ipamorelin': 'CJC W/O DAC + IPA',
    '5-Amino-1MQ': '5-AMINO-1MQ',
    'SLU-PP-332': 'SLU-PP-332',
}

def clean_spec(spec):
    s = str(spec or '')
    s = re.sub(r'\s*x\s*1\s*vial', '', s, flags=re.I)
    s = re.sub(r'\s*vial', '', s, flags=re.I).strip()
    return s.upper().replace(' ', '')

def label_name(name):
    return ALIASES.get(name, name).upper()

def font(size, bold=True):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REG), size=size)

def text_bbox(draw, xy, text, f):
    return draw.textbbox(xy, text, font=f, stroke_width=0)

def fit_font(draw, text, max_width, max_size=54, min_size=18):
    size = max_size
    while size >= min_size:
        f = font(size, True)
        bbox = text_bbox(draw, (0,0), text, f)
        if bbox[2] - bbox[0] <= max_width:
            return f
        size -= 2
    return font(min_size, True)

def cylindrical_warp(src, strength=0.18):
    src = src.convert('RGBA')
    w, h = src.size
    out = Image.new('RGBA', (w, h), (0,0,0,0))
    sp = src.load(); op = out.load()
    cx = (w - 1) / 2
    for y in range(h):
        for x in range(w):
            n = (x - cx) / cx
            # sample a slightly wider flat label into a narrower curved face
            sx = cx + math.sin(n * math.pi / 2) * cx
            sy = y + (abs(n) ** 2) * strength * 3
            ix, iy = int(round(sx)), int(round(sy))
            if 0 <= ix < w and 0 <= iy < h:
                r,g,b,a = sp[ix,iy]
                if a:
                    shade = 0.86 + 0.14 * math.cos(n * math.pi / 2)
                    op[x,y] = (int(r*shade), int(g*shade), int(b*shade), a)
    return out.filter(ImageFilter.GaussianBlur(0.15))

def draw_label(name, spec):
    W, H = 430, 185
    label = Image.new('RGBA', (W, H), (0,0,0,0))
    d = ImageDraw.Draw(label)
    product = label_name(name)
    strength = clean_spec(spec)

    # Product name, constrained to the vial face.
    name_font = fit_font(d, product, max_width=330, max_size=46, min_size=20)
    bbox = d.textbbox((0,0), product, font=name_font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    x = (W - tw) / 2
    y = 24
    d.text((x+1, y+1), product, font=name_font, fill=(250,247,241,130))
    d.text((x, y), product, font=name_font, fill=(35,56,43,255))

    # Dosage pill.
    dose_font = fit_font(d, strength, max_width=145, max_size=36, min_size=20)
    bbox = d.textbbox((0,0), strength, font=dose_font)
    dtw, dth = bbox[2]-bbox[0], bbox[3]-bbox[1]
    pad_x, pad_y = 28, 12
    pill_w, pill_h = dtw + pad_x*2, dth + pad_y*2
    px, py = (W-pill_w)/2, 88
    d.rounded_rectangle((px, py, px+pill_w, py+pill_h), radius=pill_h/2, fill=(54,58,56,238), outline=(243,239,230,120), width=2)
    d.text(((W-dtw)/2, py + (pill_h-dth)/2 - 2), strength, font=dose_font, fill=(243,239,230,255))
    return cylindrical_warp(label)

def make_mockup(product):
    base = Image.open(BASE).convert('RGBA')
    overlay = draw_label(product['name'], product['spec'])
    # Tuned to the printable label face on the master 1254x1254 vial image.
    x = 412
    y = 720
    base.alpha_composite(overlay, (x, y))
    out = OUT / f"{product['sku']}.webp"
    base.save(out, 'WEBP', quality=88, method=6)
    return out

products = json.loads(DATA.read_text(encoding='utf-8'))
for p in products:
    make_mockup(p)
print(f"Generated {len(products)} SKU mockups in {OUT}")
