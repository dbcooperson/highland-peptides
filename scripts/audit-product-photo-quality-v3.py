from __future__ import annotations

from pathlib import Path
import json
import runpy

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = json.loads((ROOT / "data" / "products.json").read_text(encoding="utf-8"))
POLISHER = runpy.run_path(str(ROOT / "scripts" / "polish-product-photo-backgrounds-v3.py"))
CORNER_MASK = POLISHER["corner_cleanup_mask"]
SOURCE_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v2-source"
OUTPUT_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v3-source"
WEB_DIR = ROOT / "public" / "images" / "product-mockups" / "full-photo-v3"


def corner_variation(image: np.ndarray) -> float:
    corner = image[:180, :180].astype(np.float32)
    return float(
        np.abs(np.diff(corner, axis=0)).mean()
        + np.abs(np.diff(corner, axis=1)).mean()
    )


before = []
after = []
protected_failures = []
for product in PRODUCTS:
    sku = product["sku"]
    source = np.asarray(Image.open(SOURCE_DIR / f"{sku}.png").convert("RGB"))
    output = np.asarray(Image.open(OUTPUT_DIR / f"{sku}.png").convert("RGB"))
    mask = np.asarray(CORNER_MASK((source.shape[1], source.shape[0])))
    protected = mask == 0
    differences = np.any(source != output, axis=2)
    changed_protected_pixels = int(np.logical_and(differences, protected).sum())
    if changed_protected_pixels:
        protected_failures.append((sku, changed_protected_pixels))
    before.append(corner_variation(source))
    after.append(corner_variation(output))

source_count = len(list(OUTPUT_DIR.glob("*.png")))
web_count = len(list(WEB_DIR.glob("*.webp")))
before_average = sum(before) / len(before)
after_average = sum(after) / len(after)

print(f"products={len(PRODUCTS)}")
print(f"v3_png={source_count}")
print(f"v3_webp={web_count}")
print(f"protected_pixel_failures={len(protected_failures)}")
print(f"average_corner_variation_before={before_average:.3f}")
print(f"average_corner_variation_after={after_average:.3f}")
print(f"corner_artifact_reduction_percent={(1 - after_average / before_average) * 100:.1f}")
print(f"smallest_lossless_webp_bytes={min(path.stat().st_size for path in WEB_DIR.glob('*.webp'))}")

if source_count != len(PRODUCTS) or web_count != len(PRODUCTS) or protected_failures:
    raise SystemExit(1)
