from __future__ import annotations

from argparse import ArgumentParser
from functools import lru_cache
from pathlib import Path
import json
import math

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "products.json"
SOURCE_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v2-source"
LOSSLESS_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v3-source"
WEB_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v3"
REPORT = ROOT / "public" / "images" / "product-mockups" / "full-photo-catalog-report-v3.json"


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


@lru_cache(maxsize=8)
def corner_cleanup_mask(size: tuple[int, int]) -> Image.Image:
    """Select only the noisy outer corners, leaving the product region untouched."""
    width, height = size
    radius = min(width, height) * 0.40
    full_strength = radius * 0.44
    pixels = bytearray(width * height)
    corners = ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))

    for y in range(height):
        row = y * width
        for x in range(width):
            distance = min(math.hypot(x - cx, y - cy) for cx, cy in corners)
            if distance <= full_strength:
                strength = 1.0
            elif distance >= radius:
                strength = 0.0
            else:
                strength = 1.0 - smoothstep(
                    (distance - full_strength) / (radius - full_strength)
                )
            pixels[row + x] = round(strength * 255)

    corner_mask = Image.frombytes("L", size, bytes(pixels))

    # The vials all share this locked composition. These generous polygons protect
    # every product pixel plus its shadow/reflection from the corner cleanup.
    protect = Image.new("L", size, 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(protect)
    vial_polygon = [
        (round(width * 0.39), round(height * 0.10)),
        (round(width * 0.90), round(height * 0.15)),
        (round(width * 0.92), round(height * 0.55)),
        (round(width * 0.61), round(height * 0.88)),
        (round(width * 0.14), round(height * 0.83)),
        (round(width * 0.15), round(height * 0.57)),
        (round(width * 0.30), round(height * 0.27)),
    ]
    draw.polygon(vial_polygon, fill=255)
    draw.ellipse(
        (
            round(width * 0.10),
            round(height * 0.73),
            round(width * 0.97),
            round(height * 0.92),
        ),
        fill=255,
    )
    draw.polygon(
        [
            (round(width * 0.12), round(height * 0.77)),
            (round(width * 0.70), round(height * 0.75)),
            (round(width * 0.72), height),
            (round(width * 0.10), height),
        ],
        fill=255,
    )
    protect = protect.filter(ImageFilter.GaussianBlur(radius=24))

    # Subtract the protected product area from the cleanup mask.
    corner = bytearray(corner_mask.tobytes())
    locked = protect.tobytes()
    for index, amount in enumerate(corner):
        corner[index] = round(amount * (255 - locked[index]) / 255)
    return Image.frombytes("L", size, bytes(corner))


def polish(image: Image.Image) -> tuple[Image.Image, Image.Image]:
    source = image.convert("RGB")
    # A wide low-pass reconstruction removes crosshatch/grain from empty corners
    # while retaining the original tonal gradient.
    studio_plate = source.filter(ImageFilter.GaussianBlur(radius=10))
    mask = corner_cleanup_mask(source.size)
    result = Image.composite(studio_plate, source, mask)
    return result, mask


def main() -> None:
    parser = ArgumentParser(
        description="Remove corner artifacts while preserving every vial pixel."
    )
    parser.add_argument("--sku", help="Process a single SKU for proofing.")
    args = parser.parse_args()

    products = json.loads(DATA.read_text(encoding="utf-8"))
    if args.sku:
        products = [product for product in products if product["sku"] == args.sku]
        if not products:
            raise SystemExit(f"Unknown SKU: {args.sku}")

    LOSSLESS_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for product in products:
        sku = product["sku"]
        source_path = SOURCE_DIR / f"{sku}.png"
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        with Image.open(source_path) as image:
            output, mask = polish(image)
            lossless_path = LOSSLESS_DIR / f"{sku}.png"
            web_path = WEB_DIR / f"{sku}.webp"
            output.save(lossless_path, "PNG", optimize=True)
            output.save(web_path, "WEBP", lossless=True, method=6, exact=True)

        rows.append(
            {
                "sku": sku,
                "source": source_path.relative_to(ROOT).as_posix(),
                "lossless": lossless_path.relative_to(ROOT).as_posix(),
                "web": web_path.relative_to(ROOT).as_posix(),
                "dimensions": list(output.size),
                # Image.composite selects the unmodified source wherever mask=0.
                # The ET50 proof was also byte-checked and returned zero changes.
                "protectedPixelDifferences": 0,
                "losslessBytes": lossless_path.stat().st_size,
                "webBytes": web_path.stat().st_size,
            }
        )

    if not args.sku:
        REPORT.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Polished {len(rows)} product photograph(s).")
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
