from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import json
import math
import re
import shutil

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "products.json"
MASTER = (
    ROOT
    / "public"
    / "images"
    / "product-mockups"
    / "highland-floating-peptide-master-v1.png"
)
BLUE_POWDER_MASTER = (
    ROOT
    / "public"
    / "images"
    / "product-mockups"
    / "highland-floating-peptide-master-blue-v1.png"
)
REVIEW_OUT = ROOT / "public" / "images" / "product-mockups" / "floating-v1"
LIVE_OUT = ROOT / "public" / "images" / "product-mockups" / "generated"
CONTACT_SHEET = (
    ROOT
    / "public"
    / "images"
    / "product-mockups"
    / "floating-catalog-contact-sheet-v1.jpg"
)

BRAND_GREEN = "#07583E"
GOLD = "#C99635"
LABEL_PAPER = (247, 246, 243, 238)

FONT_CONDENSED_CANDIDATES = [
    Path("C:/Windows/Fonts/impact.ttf"),
    Path("C:/Windows/Fonts/bahnschrift.ttf"),
    Path("C:/Windows/Fonts/arialn.ttf"),
]
FONT_BOLD_CANDIDATES = [
    Path("C:/Windows/Fonts/arialbd.ttf"),
    Path("C:/Windows/Fonts/segoeuib.ttf"),
    Path("C:/Windows/Fonts/bahnschrift.ttf"),
]
FONT_CONDENSED = next(path for path in FONT_CONDENSED_CANDIDATES if path.exists())
FONT_BOLD = next(path for path in FONT_BOLD_CANDIDATES if path.exists())

# These positions are intentionally locked to the photographed label plane.
# A single transparent artwork block is rotated with the vial, so the copy reads
# as part of the wrapped label instead of a flat screen-space overlay.
ARTWORK_SIZE = (420, 268)
ARTWORK_CENTER = (521, 818)
ARTWORK_ROTATION = -18.2

# Copper-peptide products are visibly blue in lyophilized form. These SKUs use
# the otherwise identical master containing blue powder inside the vial base.
BLUE_POWDER_SKUS = {"CU", "CU100", "BBG70", "KLOW80"}

ALIASES = {
    "BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)": "KLOW BLEND",
    "BPC-157 + GHK-Cu + TB-500 Blend (Glow)": "GLOW BLEND",
    "BPC-157 + TB-500 Blend": "BPC + TB-500",
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
    "MOTS-c": "MOTS-C",
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def text_size(draw: ImageDraw.ImageDraw, value: str, selected_font: ImageFont.FreeTypeFont):
    box = draw.textbbox((0, 0), value, font=selected_font)
    return box[2] - box[0], box[3] - box[1]


def fit_font(
    draw: ImageDraw.ImageDraw,
    value: str,
    max_width: int,
    font_path: Path,
    max_size: int,
    min_size: int,
):
    for size in range(max_size, min_size - 1, -1):
        selected = font(font_path, size)
        if text_size(draw, value, selected)[0] <= max_width:
            return selected
    return font(font_path, min_size)


def draw_centered(
    draw: ImageDraw.ImageDraw,
    value: str,
    selected_font: ImageFont.FreeTypeFont,
    center_x: float,
    center_y: float,
    fill: str,
):
    box = draw.textbbox((0, 0), value, font=selected_font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(
        (center_x - width / 2 - box[0], center_y - height / 2 - box[1]),
        value,
        font=selected_font,
        fill=fill,
    )


def product_name(value: str) -> str:
    return ALIASES.get(value, value).upper()


def product_spec(value: str) -> str:
    result = str(value or "")
    result = re.sub(r"\s*x\s*1\s*vial", "", result, flags=re.I)
    result = re.sub(r"\s*vial", "", result, flags=re.I).strip().upper()
    result = re.sub(r"(?<=\d)\s*MG", " MG", result)
    result = re.sub(r"(?<=\d)\s*ML", " ML", result)
    result = re.sub(r"(?<=\d)\s*IU", " IU", result)
    result = result.replace("MG/ ML", "MG/ML")
    result = re.sub(r"\s*\+\s*", " + ", result)
    result = re.sub(r"\s+", " ", result).strip()
    return result


def split_name(draw: ImageDraw.ImageDraw, value: str):
    one_line = fit_font(draw, value, 310, FONT_CONDENSED, 63, 28)
    if one_line.size >= 39 or len(value.split()) == 1:
        return [value], one_line

    words = value.split()
    candidates = []
    for index in range(1, len(words)):
        lines = [" ".join(words[:index]), " ".join(words[index:])]
        size = min(
            fit_font(draw, line, 310, FONT_CONDENSED, 43, 25).size
            for line in lines
        )
        widths = [text_size(draw, line, font(FONT_CONDENSED, size))[0] for line in lines]
        candidates.append((size, -abs(widths[0] - widths[1]), lines))
    chosen_size, _, lines = max(candidates, key=lambda item: (item[0], item[1]))
    return lines, font(FONT_CONDENSED, chosen_size)


def build_artwork(name: str, spec: str) -> Image.Image:
    artwork = Image.new("RGBA", ARTWORK_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(artwork)

    lines, name_font = split_name(draw, product_name(name))
    if len(lines) == 1:
        draw_centered(draw, lines[0], name_font, 210, 65, BRAND_GREEN)
        accent_y = 117
        dose_center_y = 186
    else:
        line_height = name_font.size + 4
        first_center = 39
        for index, line in enumerate(lines):
            draw_centered(
                draw,
                line,
                name_font,
                210,
                first_center + index * line_height,
                BRAND_GREEN,
            )
        accent_y = 124
        dose_center_y = 194

    draw.rounded_rectangle((176, accent_y, 244, accent_y + 7), radius=4, fill=GOLD)

    clean = product_spec(spec)
    dose_font = fit_font(draw, clean, 260, FONT_BOLD, 42, 23)
    text_width, _ = text_size(draw, clean, dose_font)
    box_width = max(178, min(306, text_width + 58))
    box_height = 73
    left = 210 - box_width / 2
    top = dose_center_y - box_height / 2
    draw.rounded_rectangle(
        (left, top, left + box_width, top + box_height),
        radius=18,
        outline=BRAND_GREEN,
        width=4,
    )
    draw_centered(draw, clean, dose_font, 210, dose_center_y, BRAND_GREEN)
    return artwork


def apply_label_falloff(artwork: Image.Image) -> Image.Image:
    """Subtle edge falloff makes the new copy share the label's curvature."""
    shaded = artwork.copy()
    px = shaded.load()
    width, height = shaded.size
    for x in range(width):
        edge = abs((x - width / 2) / (width / 2))
        factor = 1.0 - 0.15 * edge**1.7
        for y in range(height):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (round(r * factor), round(g * factor), round(b * factor), a)
    return shaded


def render_product(master: Image.Image, name: str, spec: str) -> Image.Image:
    image = master.convert("RGBA").copy()
    artwork = apply_label_falloff(build_artwork(name, spec))
    rotated = artwork.rotate(
        ARTWORK_ROTATION,
        expand=True,
        resample=Image.Resampling.BICUBIC,
    )
    x = round(ARTWORK_CENTER[0] - rotated.width / 2)
    y = round(ARTWORK_CENTER[1] - rotated.height / 2)
    image.alpha_composite(rotated, (x, y))
    return image.convert("RGB")


def load_all_products():
    return json.loads(DATA.read_text(encoding="utf-8"))


def load_products():
    return [
        product
        for product in load_all_products()
        if product.get("category") == "Peptide"
    ]


def save_webp(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=96, method=6)


def make_contact_sheet(products, output_dir: Path):
    thumb_width = 246
    master_width, master_height = Image.open(MASTER).size
    thumb_height = round(thumb_width * master_height / master_width)
    label_height = 49
    columns = 5
    rows = math.ceil(len(products) / columns)
    gap = 18
    margin = 30
    sheet = Image.new(
        "RGB",
        (
            margin * 2 + columns * thumb_width + (columns - 1) * gap,
            margin * 2 + rows * (thumb_height + label_height) + (rows - 1) * gap,
        ),
        "#EEEAE2",
    )
    draw = ImageDraw.Draw(sheet)
    caption_font = font(FONT_BOLD, 18)
    for index, product in enumerate(products):
        col = index % columns
        row = index // columns
        x = margin + col * (thumb_width + gap)
        y = margin + row * (thumb_height + label_height + gap)
        image_path = output_dir / f"{product['sku']}.webp"
        thumb = Image.open(image_path).convert("RGB").resize(
            (thumb_width, thumb_height), Image.Resampling.LANCZOS
        )
        sheet.paste(thumb, (x, y))
        caption = f"{product['sku']} · {product_name(product['name'])} · {product_spec(product['spec'])}"
        caption = caption if len(caption) <= 35 else caption[:34] + "…"
        draw.text((x, y + thumb_height + 12), caption, font=caption_font, fill="#173E31")
    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET, "JPEG", quality=92, optimize=True)


def main():
    parser = ArgumentParser(description="Generate Highland floating-vial product mockups.")
    parser.add_argument("--sku", action="append", help="Generate only one or more SKUs.")
    parser.add_argument("--name", help="Render an ad-hoc product name.")
    parser.add_argument("--spec", help="Render an ad-hoc product dosage/spec.")
    parser.add_argument("--output", type=Path, help="Output path for an ad-hoc image.")
    parser.add_argument(
        "--replace-current",
        action="store_true",
        help="Copy approved review images into the live storefront image directory.",
    )
    parser.add_argument(
        "--contact-sheet-only",
        action="store_true",
        help="Rebuild the contact sheet from all review images already on disk.",
    )
    parser.add_argument(
        "--blue-powder",
        action="store_true",
        help="Use the cobalt-blue lyophilized-powder master for an ad-hoc image.",
    )
    args = parser.parse_args()

    master = Image.open(MASTER).convert("RGBA")
    blue_master = (
        Image.open(BLUE_POWDER_MASTER).convert("RGBA")
        if BLUE_POWDER_MASTER.exists()
        else None
    )
    if args.name or args.spec or args.output:
        if not (args.name and args.spec and args.output):
            parser.error("--name, --spec, and --output must be supplied together")
        selected_master = blue_master if args.blue_powder else master
        if selected_master is None:
            parser.error(f"Blue-powder master not found: {BLUE_POWDER_MASTER}")
        save_webp(render_product(selected_master, args.name, args.spec), args.output)
        print(f"Rendered {args.output}")
        return

    if args.contact_sheet_only:
        products = [
            product
            for product in load_all_products()
            if (REVIEW_OUT / f"{product['sku']}.webp").exists()
        ]
        make_contact_sheet(products, REVIEW_OUT)
        print(f"Contact sheet -> {CONTACT_SHEET}")
        return

    products = load_products()
    if args.sku:
        requested = set(args.sku)
        products = [product for product in products if product["sku"] in requested]
        missing = requested - {product["sku"] for product in products}
        if missing:
            parser.error(f"Unknown or non-peptide SKU(s): {', '.join(sorted(missing))}")

    REVIEW_OUT.mkdir(parents=True, exist_ok=True)
    for product in products:
        output = REVIEW_OUT / f"{product['sku']}.webp"
        selected_master = master
        if product["sku"] in BLUE_POWDER_SKUS:
            if blue_master is None:
                parser.error(f"Blue-powder master not found: {BLUE_POWDER_MASTER}")
            selected_master = blue_master
        save_webp(
            render_product(selected_master, product["name"], product["spec"]),
            output,
        )
        print(f"Rendered {product['sku']} -> {output}")

    if not args.sku:
        review_products = [
            product
            for product in load_all_products()
            if (REVIEW_OUT / f"{product['sku']}.webp").exists()
        ]
        make_contact_sheet(review_products, REVIEW_OUT)
        print(f"Contact sheet -> {CONTACT_SHEET}")

    if args.replace_current:
        LIVE_OUT.mkdir(parents=True, exist_ok=True)
        approved_products = [
            product
            for product in load_all_products()
            if (REVIEW_OUT / f"{product['sku']}.webp").exists()
        ]
        for product in approved_products:
            shutil.copy2(REVIEW_OUT / f"{product['sku']}.webp", LIVE_OUT / f"{product['sku']}.webp")
        print(f"Copied {len(approved_products)} approved images into {LIVE_OUT}")


if __name__ == "__main__":
    main()
