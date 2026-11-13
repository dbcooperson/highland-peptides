from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import json
import math
import shutil

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "products.json"
SOURCE_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v2-source"
REVIEW_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v2"
LIVE_DIR = ROOT / "public" / "images" / "product-mockups" / "generated"
CONTACT_SHEET = (
    ROOT
    / "public"
    / "images"
    / "product-mockups"
    / "full-photo-catalog-contact-sheet-v2.jpg"
)
REPORT = (
    ROOT
    / "public"
    / "images"
    / "product-mockups"
    / "full-photo-catalog-report-v2.json"
)

DELIVERY_SIZE = (1126, 1397)
FONT = Path("C:/Windows/Fonts/arialbd.ttf")


def products():
    return json.loads(DATA.read_text(encoding="utf-8"))


def normalize(image: Image.Image) -> Image.Image:
    """Normalize the 1–3 px output variance without changing composition."""
    if image.size == DELIVERY_SIZE:
        return image.convert("RGB")
    return image.convert("RGB").resize(DELIVERY_SIZE, Image.Resampling.LANCZOS)


def build_web_assets(items):
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    for product in items:
        source = SOURCE_DIR / f"{product['sku']}.png"
        if not source.exists():
            raise FileNotFoundError(f"Missing full-photo source: {source}")
        with Image.open(source) as image:
            source_size = image.size
            normalized = normalize(image)
            output = REVIEW_DIR / f"{product['sku']}.webp"
            normalized.save(output, "WEBP", quality=98, method=6)
        report.append(
            {
                "sku": product["sku"],
                "name": product["name"],
                "spec": product["spec"],
                "source": source.relative_to(ROOT).as_posix(),
                "review": output.relative_to(ROOT).as_posix(),
                "sourceDimensions": list(source_size),
                "deliveryDimensions": list(DELIVERY_SIZE),
                "sourceBytes": source.stat().st_size,
                "reviewBytes": output.stat().st_size,
            }
        )
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def build_contact_sheet(items):
    thumb_width = 225
    thumb_height = round(thumb_width * DELIVERY_SIZE[1] / DELIVERY_SIZE[0])
    caption_height = 52
    columns = 5
    gap = 18
    margin = 28
    rows = math.ceil(len(items) / columns)
    sheet = Image.new(
        "RGB",
        (
            margin * 2 + columns * thumb_width + (columns - 1) * gap,
            margin * 2 + rows * (thumb_height + caption_height) + (rows - 1) * gap,
        ),
        "#EEEAE2",
    )
    draw = ImageDraw.Draw(sheet)
    caption_font = ImageFont.truetype(str(FONT), 17)
    for index, product in enumerate(items):
        col = index % columns
        row = index // columns
        x = margin + col * (thumb_width + gap)
        y = margin + row * (thumb_height + caption_height + gap)
        with Image.open(REVIEW_DIR / f"{product['sku']}.webp") as image:
            thumb = image.convert("RGB").resize(
                (thumb_width, thumb_height), Image.Resampling.LANCZOS
            )
        sheet.paste(thumb, (x, y))
        caption = f"{product['sku']} · {product['name']} · {product['spec']}"
        if len(caption) > 39:
            caption = caption[:38] + "…"
        draw.text(
            (x, y + thumb_height + 12),
            caption,
            font=caption_font,
            fill="#173E31",
        )
    sheet.save(CONTACT_SHEET, "JPEG", quality=94, optimize=True)


def publish(items):
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    for product in items:
        shutil.copy2(
            REVIEW_DIR / f"{product['sku']}.webp",
            LIVE_DIR / f"{product['sku']}.webp",
        )


def main():
    parser = ArgumentParser(
        description="Build and optionally publish the Highland full-photo v2 catalog."
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Replace live storefront images after the review set is approved.",
    )
    args = parser.parse_args()
    items = products()
    report = build_web_assets(items)
    build_contact_sheet(items)
    print(f"Built {len(report)} full-photo review images in {REVIEW_DIR}")
    print(f"Contact sheet: {CONTACT_SHEET}")
    print(f"Report: {REPORT}")
    if args.publish:
        publish(items)
        print(f"Published {len(items)} images to {LIVE_DIR}")


if __name__ == "__main__":
    main()
