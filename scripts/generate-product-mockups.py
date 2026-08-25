from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json
import re


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "public" / "images" / "product-mockups" / "highland-vial-offwhite-master-v1.png"
OUT = ROOT / "public" / "images" / "product-mockups" / "generated"
DATA = ROOT / "data" / "products.json"
OUT.mkdir(parents=True, exist_ok=True)

# The reference is intentionally spacious, but product cards and the square
# product-detail frame need the vial to read clearly at smaller sizes. Zoom the
# finished composition (rather than only the bottle) so the vertical purity
# line, label typography, shadow, and vial remain proportionally consistent.
COMPOSITION_ZOOM = 1.28


FONT_NAME_CANDIDATES = [
    Path("C:/Windows/Fonts/impact.ttf"),
    Path("C:/Windows/Fonts/bahnschrift.ttf"),
    Path("C:/Windows/Fonts/arialn.ttf"),
    Path("C:/Windows/Fonts/arialbd.ttf"),
]
FONT_BOLD_CANDIDATES = [
    Path("C:/Windows/Fonts/arialbd.ttf"),
    Path("C:/Windows/Fonts/segoeuib.ttf"),
    Path("C:/Windows/Fonts/bahnschrift.ttf"),
]

FONT_NAME = next((path for path in FONT_NAME_CANDIDATES if path.exists()), None)
FONT_BOLD = next((path for path in FONT_BOLD_CANDIDATES if path.exists()), FONT_NAME)

if not FONT_NAME or not FONT_BOLD:
    raise RuntimeError("A suitable Windows font could not be located.")


# Only abbreviate names that cannot remain readable on the physical label face.
ALIASES = {
    "BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)": "KLOW BLEND",
    "BPC-157 + GHK-Cu + TB-500 Blend (Glow)": "GLOW BLEND",
    "BPC-157 + TB-500 Blend": "BPC + TB-500",
    "Bacteriostatic Water": "BAC WATER",
    "CJC-1295 without DAC + Ipamorelin": "CJC W/O DAC + IPA",
    "CJC-1295 without DAC": "CJC-1295 W/O DAC",
    "CJC-1295 with DAC": "CJC-1295 W/ DAC",
    "Cagrilintide + Semaglutide": "CAGRI + SEMA",
    "Semax 10mg + Selank 10mg": "SEMAX + SELANK",
    "Semax 5mg + Selank 5mg": "SEMAX + SELANK",
    "GHRP-2 Acetate": "GHRP-2",
    "GHRP-6 Acetate": "GHRP-6",
    "Oxytocin Acetate": "OXYTOCIN",
    "NA-Selank Amidate": "NA-SELANK",
}


def font(path, size):
    return ImageFont.truetype(str(path), size=size)


def text_size(draw, text, selected_font):
    box = draw.textbbox((0, 0), text, font=selected_font)
    return box[2] - box[0], box[3] - box[1]


def fit_font(draw, text, max_width, font_path, max_size, min_size):
    for size in range(max_size, min_size - 1, -1):
        selected = font(font_path, size)
        if text_size(draw, text, selected)[0] <= max_width:
            return selected
    return font(font_path, min_size)


def split_name(draw, text, max_width):
    """Keep short names on one line and split long phrases into two balanced lines."""
    one_line = fit_font(draw, text, max_width, FONT_NAME, 61, 26)
    if text_size(draw, text, one_line)[0] <= max_width and one_line.size >= 36:
        return [text], one_line

    words = text.split()
    if len(words) == 1:
        return [text], one_line

    candidates = []
    for index in range(1, len(words)):
        lines = [" ".join(words[:index]), " ".join(words[index:])]
        selected = min(
            fit_font(draw, line, max_width, FONT_NAME, 39, 22).size
            for line in lines
        )
        widths = [text_size(draw, line, font(FONT_NAME, selected))[0] for line in lines]
        candidates.append((selected, -abs(widths[0] - widths[1]), lines))

    selected_size, _, lines = max(candidates, key=lambda item: (item[0], item[1]))
    return lines, font(FONT_NAME, selected_size)


def label_name(name):
    return ALIASES.get(name, name).upper()


def clean_spec(spec):
    value = str(spec or "")
    value = re.sub(r"\s*x\s*1\s*vial", "", value, flags=re.I)
    value = re.sub(r"\s*vial", "", value, flags=re.I).strip().upper()
    value = re.sub(r"(?<=\d)\s*MG", " MG", value)
    value = re.sub(r"(?<=\d)\s*ML", " ML", value)
    value = re.sub(r"(?<=\d)\s*IU", " IU", value)
    value = value.replace("MG/ ML", "MG/ML")
    value = re.sub(r"\s*\+\s*", " + ", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(
        r"^(\d+(?:\.\d+)?\s+MG/ML)\s+(.+)$",
        r"\1 · \2",
        value,
    )
    return value


def draw_centered(draw, text, selected_font, center_x, top_y, fill):
    width, height = text_size(draw, text, selected_font)
    draw.text((center_x - width / 2, top_y), text, font=selected_font, fill=fill)
    return height


def add_variable_label(base, product):
    draw = ImageDraw.Draw(base)
    center_x = 768
    max_name_width = 292
    product_name = label_name(product["name"])
    lines, name_font = split_name(draw, product_name, max_name_width)

    if len(lines) == 1:
        name_top = 590
        line_gap = 0
    else:
        name_top = 568
        line_gap = 4

    heights = [text_size(draw, line, name_font)[1] for line in lines]
    current_y = name_top
    for line, height in zip(lines, heights):
        draw_centered(draw, line, name_font, center_x, current_y, "#111411")
        current_y += height + line_gap

    dose_text = clean_spec(product["spec"])
    dose_font = fit_font(draw, dose_text, 190, FONT_BOLD, 40, 22)
    dose_width, dose_height = text_size(draw, dose_text, dose_font)
    pill_width = max(166, dose_width + 46)
    pill_height = max(58, dose_height + 22)
    pill_left = center_x - pill_width / 2
    pill_top = 692 if len(lines) == 1 else 700
    pill_right = center_x + pill_width / 2
    pill_bottom = pill_top + pill_height
    draw.rounded_rectangle(
        (pill_left, pill_top, pill_right, pill_bottom),
        radius=pill_height / 2,
        fill="#145039",
        outline="#0d3b2a",
        width=2,
    )
    draw_centered(
        draw,
        dose_text,
        dose_font,
        center_x,
        pill_top + (pill_height - dose_height) / 2 - 2,
        "#faf7f1",
    )


def zoom_composition(image):
    width, height = image.size
    crop_width = round(width / COMPOSITION_ZOOM)
    crop_height = round(height / COMPOSITION_ZOOM)
    left = (width - crop_width) // 2

    # Bias the crop slightly upward from dead center: this preserves the full
    # cap, keeps the vial base visible, and removes mostly empty outer space.
    top = max(0, (height - crop_height) // 2 - 12)
    crop = image.crop((left, top, left + crop_width, top + crop_height))
    return crop.resize((width, height), Image.Resampling.LANCZOS)


def make_mockup(product, master):
    image = master.copy()
    add_variable_label(image, product)
    image = zoom_composition(image)
    output = OUT / f"{product['sku']}.webp"
    image.save(output, "WEBP", quality=94, method=6)
    return output


def make_contact_sheet(products):
    thumb_width, thumb_height = 360, 240
    columns = 4
    rows = (len(products) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumb_width, rows * thumb_height), "#f3efe6")
    for index, product in enumerate(products):
        image_path = OUT / f"{product['sku']}.webp"
        thumb = Image.open(image_path).convert("RGB")
        thumb.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = (index % columns) * thumb_width + (thumb_width - thumb.width) // 2
        y = (index // columns) * thumb_height + (thumb_height - thumb.height) // 2
        sheet.paste(thumb, (x, y))
    contact_path = OUT.parent / "offwhite-catalog-contact-sheet.jpg"
    sheet.save(contact_path, "JPEG", quality=90, optimize=True)
    return contact_path


def main():
    products = json.loads(DATA.read_text(encoding="utf-8"))
    master = Image.open(BASE).convert("RGB")
    for product in products:
        make_mockup(product, master)
    contact_sheet = make_contact_sheet(products)
    print(f"Generated {len(products)} off-white SKU mockups in {OUT}")
    print(f"Contact sheet: {contact_sheet}")


if __name__ == "__main__":
    main()
