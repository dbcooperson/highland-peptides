from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import json
import re

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "imagegen" / "MS40-label-redesign-offwhite-shadow-v2.png"
MASTER = ROOT / "public" / "images" / "product-mockups" / "highland-vial-offwhite-master-v2.png"
DATA = ROOT / "data" / "products.json"
PREVIEW_OUT = ROOT / "public" / "images" / "product-mockups" / "generated-v2"
LIVE_OUT = ROOT / "public" / "images" / "product-mockups" / "generated"

CANVAS_SIZE = (1536, 1024)
LABEL_LEFT = 566
LABEL_RIGHT = 968
LABEL_CENTER = (LABEL_LEFT + LABEL_RIGHT) // 2
VARIABLE_TOP = 585
VARIABLE_BOTTOM = 841
BAND_TOP = 842
BAND_BOTTOM = 927

# Flat brand colors keep the lettering green instead of inheriting the
# black/green texture that image-generation introduced into the raster text.
BRAND_GREEN = "#07583E"
BAND_GREEN = "#07583E"
GOLD = "#D89A12"
LABEL_WHITE = "#F7F4EE"
BACKGROUND_WHITE = "#F8F5EF"

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

FONT_CONDENSED = next((path for path in FONT_CONDENSED_CANDIDATES if path.exists()), None)
FONT_BOLD = next((path for path in FONT_BOLD_CANDIDATES if path.exists()), None)

if not FONT_CONDENSED or not FONT_BOLD:
    raise RuntimeError("The required Windows fonts could not be located.")


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


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def text_box(draw: ImageDraw.ImageDraw, value: str, selected_font: ImageFont.FreeTypeFont):
    return draw.textbbox((0, 0), value, font=selected_font)


def text_size(draw: ImageDraw.ImageDraw, value: str, selected_font: ImageFont.FreeTypeFont):
    box = text_box(draw, value, selected_font)
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
    box = text_box(draw, value, selected_font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    x = center_x - width / 2 - box[0]
    y = center_y - height / 2 - box[1]
    draw.text((x, y), value, font=selected_font, fill=fill)


def label_name(value: str) -> str:
    return ALIASES.get(value, value).upper()


def clean_spec(value: str) -> str:
    result = str(value or "")
    result = re.sub(r"\s*x\s*1\s*vial", "", result, flags=re.I)
    result = re.sub(r"\s*vial", "", result, flags=re.I).strip().upper()
    result = re.sub(r"(?<=\d)\s*MG", " MG", result)
    result = re.sub(r"(?<=\d)\s*ML", " ML", result)
    result = re.sub(r"(?<=\d)\s*IU", " IU", result)
    result = result.replace("MG/ ML", "MG/ML")
    result = re.sub(r"\s*\+\s*", " + ", result)
    result = re.sub(r"\s+", " ", result).strip()
    result = re.sub(r"^(\d+(?:\.\d+)?\s+MG/ML)\s+(.+)$", r"\1 · \2", result)
    return result


def split_name(draw: ImageDraw.ImageDraw, value: str, max_width: int):
    selected = fit_font(draw, value, max_width, FONT_CONDENSED, 68, 28)
    if selected.size >= 39 or len(value.split()) == 1:
        return [value], selected

    words = value.split()
    candidates = []
    for index in range(1, len(words)):
        lines = [" ".join(words[:index]), " ".join(words[index:])]
        size = min(
            fit_font(draw, line, max_width, FONT_CONDENSED, 43, 25).size
            for line in lines
        )
        widths = [text_size(draw, line, font(FONT_CONDENSED, size))[0] for line in lines]
        candidates.append((size, -abs(widths[0] - widths[1]), lines))

    chosen_size, _, lines = max(candidates, key=lambda item: (item[0], item[1]))
    return lines, font(FONT_CONDENSED, chosen_size)


def blend_left_background(image: Image.Image) -> Image.Image:
    """Remove rasterized vertical copy and blend back into the off-white studio field."""
    overlay = Image.new("RGBA", image.size, BACKGROUND_WHITE + "00")
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 175, image.height), fill=BACKGROUND_WHITE + "FF")
    for x in range(176, 321):
        alpha = round(255 * (1 - (x - 175) / 145))
        draw.line((x, 0, x, image.height), fill=BACKGROUND_WHITE + f"{alpha:02X}")
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def clear_variable_label(image: Image.Image):
    """Replace generated lettering with one clean, warm off-white label field."""
    draw = ImageDraw.Draw(image)
    draw.rectangle(
        (LABEL_LEFT, VARIABLE_TOP, LABEL_RIGHT, VARIABLE_BOTTOM),
        fill=LABEL_WHITE,
    )


def draw_vertical_purity(image: Image.Image):
    selected_font = font(FONT_BOLD, 82)
    value = "99% PURITY"
    scratch = Image.new("RGBA", (760, 130), (0, 0, 0, 0))
    scratch_draw = ImageDraw.Draw(scratch)
    box = scratch_draw.textbbox((0, 0), value, font=selected_font)
    scratch_draw.text((8 - box[0], 8 - box[1]), value, font=selected_font, fill=BRAND_GREEN)
    cropped = scratch.crop(scratch.getbbox())
    rotated = cropped.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    target_height = 646
    if rotated.height != target_height:
        new_width = round(rotated.width * target_height / rotated.height)
        rotated = rotated.resize((new_width, target_height), Image.Resampling.LANCZOS)
    image.alpha_composite(rotated, (37, 220))


def draw_information_band(draw: ImageDraw.ImageDraw):
    band_points = [
        (LABEL_LEFT, BAND_TOP),
        (666, BAND_TOP + 4),
        (LABEL_CENTER, BAND_TOP + 6),
        (868, BAND_TOP + 4),
        (LABEL_RIGHT, BAND_TOP),
        (LABEL_RIGHT, BAND_BOTTOM),
        (LABEL_LEFT, BAND_BOTTOM),
    ]
    draw.polygon(band_points, fill=BAND_GREEN)
    selected = font(FONT_CONDENSED, 20)
    draw_centered(draw, "99% PURITY", selected, 637, 884, LABEL_WHITE)
    draw.ellipse((730, 876, 744, 890), fill=GOLD)
    draw_centered(draw, "RESEARCH USE ONLY", selected, 853, 884, LABEL_WHITE)


def apply_cylindrical_label_shading(image: Image.Image):
    """Give the flat label artwork the light falloff of paper wrapped on glass.

    Only the light label stock and the dark-green band are shaded. Letterforms,
    dosage outlines, the gold accent, and the logo retain their exact colors.
    """
    pixels = image.load()
    half_width = (LABEL_RIGHT - LABEL_LEFT) / 2

    for x in range(LABEL_LEFT, LABEL_RIGHT + 1):
        normalized = (x - LABEL_CENTER) / half_width
        edge = abs(normalized)

        # A narrow center highlight plus progressively darker shoulders makes
        # the label read as a sheet following the vial's cylindrical surface.
        stock_factor = 1.025 - 0.165 * (edge ** 1.65)
        band_factor = 1.035 - 0.22 * (edge ** 1.55)

        for y in range(461, BAND_BOTTOM + 1):
            red, green, blue, alpha = pixels[x, y]

            if y < BAND_TOP:
                # Shade only warm-white label stock, never the colored type.
                if red > 175 and green > 170 and blue > 160:
                    pixels[x, y] = (
                        min(255, round(red * stock_factor)),
                        min(255, round(green * stock_factor)),
                        min(255, round(blue * stock_factor)),
                        alpha,
                    )
            else:
                # Shade the green band while leaving its white and gold copy
                # mathematically untouched.
                is_green_band = red < 70 and 55 < green < 135 and blue < 105
                if is_green_band:
                    pixels[x, y] = (
                        min(255, round(red * band_factor)),
                        min(255, round(green * band_factor)),
                        min(255, round(blue * band_factor)),
                        alpha,
                    )


def build_master(source_path: Path = SOURCE) -> Image.Image:
    image = Image.open(source_path).convert("RGBA")
    if image.size != CANVAS_SIZE:
        image = image.resize(CANVAS_SIZE, Image.Resampling.LANCZOS)
    image = blend_left_background(image)
    clear_variable_label(image)
    draw = ImageDraw.Draw(image)
    draw_information_band(draw)
    draw_vertical_purity(image)
    return image


def add_variable_label(master: Image.Image, product: dict) -> Image.Image:
    image = master.copy().convert("RGBA")
    draw = ImageDraw.Draw(image)
    name = label_name(product["name"])
    lines, name_font = split_name(draw, name, 330)

    if len(lines) == 1:
        centers = [650]
        gold_y = 723
        dose_center_y = 786
    else:
        centers = [625, 672]
        gold_y = 716
        dose_center_y = 786

    for line, center_y in zip(lines, centers):
        draw_centered(draw, line, name_font, LABEL_CENTER, center_y, BRAND_GREEN)

    draw.rounded_rectangle(
        (LABEL_CENTER - 46, gold_y, LABEL_CENTER + 46, gold_y + 5),
        radius=2,
        fill=GOLD,
    )

    dose = clean_spec(product["spec"])
    dose_font = fit_font(draw, dose, 236, FONT_BOLD, 39, 22)
    dose_width, _ = text_size(draw, dose, dose_font)
    box_width = max(206, dose_width + 52)
    box_height = 70
    box = (
        LABEL_CENTER - box_width / 2,
        dose_center_y - box_height / 2,
        LABEL_CENTER + box_width / 2,
        dose_center_y + box_height / 2,
    )
    draw.rounded_rectangle(box, radius=15, fill=None, outline=BRAND_GREEN, width=3)
    draw_centered(draw, dose, dose_font, LABEL_CENTER, dose_center_y, BRAND_GREEN)
    apply_cylindrical_label_shading(image)
    return image


def make_mockup(product: dict, master: Image.Image, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    image = add_variable_label(master, product).convert("RGB")
    output = output_dir / f"{product['sku']}.webp"
    image.save(output, "WEBP", quality=95, method=6)
    return output


def make_contact_sheet(products: list[dict], output_dir: Path) -> Path:
    thumb_width, thumb_height = 384, 256
    columns = 4
    rows = (len(products) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumb_width, rows * thumb_height), BACKGROUND_WHITE)
    for index, product in enumerate(products):
        image_path = output_dir / f"{product['sku']}.webp"
        thumb = Image.open(image_path).convert("RGB")
        thumb.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = (index % columns) * thumb_width + (thumb_width - thumb.width) // 2
        y = (index // columns) * thumb_height + (thumb_height - thumb.height) // 2
        sheet.paste(thumb, (x, y))
    output = output_dir.parent / "offwhite-catalog-contact-sheet-v2.jpg"
    sheet.save(output, "JPEG", quality=91, optimize=True)
    return output


def parse_args():
    parser = ArgumentParser(description="Generate Highland Peptides V2 storefront vial mockups.")
    parser.add_argument("--sku", help="Generate only one product from data/products.json.")
    parser.add_argument("--name", help="Generate an arbitrary product name (requires --spec).")
    parser.add_argument("--spec", help="Generate an arbitrary dosage/specification (requires --name).")
    parser.add_argument("--output", type=Path, help="Output path for an arbitrary product preview.")
    parser.add_argument(
        "--replace-current",
        action="store_true",
        help="Write into the live generated directory instead of generated-v2.",
    )
    parser.add_argument("--master-only", action="store_true", help="Only rebuild the blank V2 master.")
    return parser.parse_args()


def main():
    args = parse_args()
    master = build_master()
    MASTER.parent.mkdir(parents=True, exist_ok=True)
    master_preview = master.copy()
    apply_cylindrical_label_shading(master_preview)
    master_preview.convert("RGB").save(MASTER, "PNG", optimize=True)
    print(f"Master template: {MASTER}")

    if args.master_only:
        return

    output_dir = LIVE_OUT if args.replace_current else PREVIEW_OUT
    products = json.loads(DATA.read_text(encoding="utf-8"))

    if args.name or args.spec:
        if not args.name or not args.spec:
            raise SystemExit("--name and --spec must be supplied together.")
        product = {"sku": "CUSTOM", "name": args.name, "spec": args.spec}
        image = add_variable_label(master, product).convert("RGB")
        output = args.output or (output_dir / "CUSTOM.webp")
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, output.suffix.removeprefix(".").upper() or "WEBP", quality=95)
        print(f"Custom preview: {output}")
        return

    selected_products = products
    if args.sku:
        selected_products = [product for product in products if product["sku"].upper() == args.sku.upper()]
        if not selected_products:
            raise SystemExit(f"Unknown SKU: {args.sku}")

    for product in selected_products:
        make_mockup(product, master, output_dir)

    print(f"Generated {len(selected_products)} V2 mockup(s) in {output_dir}")
    if not args.sku:
        print(f"Contact sheet: {make_contact_sheet(selected_products, output_dir)}")


if __name__ == "__main__":
    main()
