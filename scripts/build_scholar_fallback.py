from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def polygon_mask(size: tuple[int, int], polygons: list[list[tuple[int, int]]]) -> np.ndarray:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    return np.asarray(mask) > 0


def recolor_hsv(
    rgba: Image.Image,
    mask: np.ndarray,
    *,
    hue: int,
    saturation: int,
    value_scale: float,
) -> Image.Image:
    rgb = rgba.convert("RGB")
    hsv = np.asarray(rgb.convert("HSV")).copy()
    original_saturation = hsv[..., 1].copy()
    hsv[..., 0][mask] = hue
    hsv[..., 1][mask] = np.clip(
        saturation + original_saturation[mask] * 0.18,
        0,
        255,
    ).astype(np.uint8)
    hsv[..., 2][mask] = np.clip(
        hsv[..., 2][mask].astype(np.float32) * value_scale,
        0,
        255,
    ).astype(np.uint8)
    result = Image.merge("RGBA", (*Image.fromarray(hsv, "HSV").convert("RGB").split(), rgba.getchannel("A")))
    return result


def add_round_glasses(base: Image.Image) -> Image.Image:
    scale = 4
    overlay = Image.new("RGBA", (base.width * scale, base.height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    frame = (80, 49, 35, 245)
    highlight = (198, 144, 78, 210)
    lens = (168, 207, 210, 20)

    left = (195 * scale, 168 * scale, 276 * scale, 241 * scale)
    right = (258 * scale, 151 * scale, 342 * scale, 225 * scale)
    draw.ellipse(left, fill=lens, outline=frame, width=4 * scale)
    draw.ellipse(right, fill=lens, outline=frame, width=4 * scale)
    draw.arc(left, start=205, end=335, fill=highlight, width=1 * scale)
    draw.arc(right, start=205, end=335, fill=highlight, width=1 * scale)
    draw.line((273 * scale, 190 * scale, 265 * scale, 184 * scale), fill=frame, width=4 * scale)
    draw.line((197 * scale, 190 * scale, 166 * scale, 168 * scale), fill=frame, width=3 * scale)
    draw.line((340 * scale, 182 * scale, 379 * scale, 193 * scale), fill=frame, width=3 * scale)

    overlay = overlay.resize(base.size, Image.Resampling.LANCZOS)
    return Image.alpha_composite(base, overlay)


def build(source: Path, output: Path, source_copy: Path | None) -> None:
    original = Image.open(source).convert("RGBA")
    width, height = original.size
    if (width, height) != (831, 1174):
        raise ValueError(f"Expected 831x1174 source, received {width}x{height}")

    alpha = np.asarray(original.getchannel("A"))
    hsv = np.asarray(original.convert("RGB").convert("HSV"))

    outer_uniform_region = polygon_mask(
        original.size,
        [
            [(322, 245), (520, 190), (642, 270), (713, 552), (582, 704), (328, 646), (270, 435)],
            [(150, 365), (351, 342), (425, 423), (342, 510), (169, 492), (122, 448)],
            [(260, 430), (425, 390), (487, 494), (326, 625), (209, 588), (209, 527)],
        ],
    )
    skin_exclusion = polygon_mask(
        original.size,
        [
            [(128, 90), (394, 86), (424, 244), (365, 329), (185, 320), (144, 278)],
            [(15, 420), (181, 415), (204, 491), (86, 527), (8, 495)],
            [(103, 520), (254, 500), (287, 600), (179, 654), (96, 611)],
        ],
    )
    skin_preserve = (
        skin_exclusion
        & (alpha > 32)
        & (hsv[..., 2] > 38)
        & ((hsv[..., 1] < 140) | (hsv[..., 0] < 18) | (hsv[..., 0] > 232))
    )
    outer_uniform = (
        outer_uniform_region
        & ~skin_preserve
        & (alpha > 32)
        & (hsv[..., 1] < 118)
        & (hsv[..., 2] > 24)
        & (hsv[..., 2] < 210)
    )

    hoodie_region = polygon_mask(
        original.size,
        [
            [(298, 147), (550, 145), (584, 348), (530, 660), (338, 652), (299, 390)],
            [(278, 417), (355, 420), (343, 548), (260, 557)],
            [(171, 340), (273, 346), (276, 471), (184, 472)],
        ],
    )
    hoodie = (
        hoodie_region
        & ~skin_preserve
        & (alpha > 32)
        & (hsv[..., 0] >= 18)
        & (hsv[..., 0] <= 58)
        & (hsv[..., 1] > 55)
        & (hsv[..., 2] > 45)
    )

    pants_region = polygon_mask(
        original.size,
        [[(278, 608), (563, 590), (743, 952), (687, 1042), (537, 931), (410, 1030), (249, 1017)]],
    )
    pants = (
        pants_region
        & (alpha > 32)
        & (hsv[..., 0] >= 18)
        & (hsv[..., 0] <= 66)
        & (hsv[..., 1] > 32)
        & (hsv[..., 2] > 25)
        & (hsv[..., 2] < 205)
    )

    red_accent_region = polygon_mask(
        original.size,
        [[(332, 210), (704, 207), (743, 565), (420, 538)]],
    )
    red_accents = (
        red_accent_region
        & ~skin_preserve
        & (alpha > 32)
        & ((hsv[..., 0] < 16) | (hsv[..., 0] > 238))
        & (hsv[..., 1] > 90)
        & (hsv[..., 2] > 45)
    )

    card_region = polygon_mask(
        original.size,
        [[(438, 450), (586, 447), (586, 590), (438, 590)]],
    )
    card_preserve = (
        card_region
        & (alpha > 32)
        & (hsv[..., 1] < 104)
        & (hsv[..., 2] > 150)
    )

    recolored = recolor_hsv(original, outer_uniform, hue=96, saturation=105, value_scale=0.90)
    recolored = recolor_hsv(recolored, hoodie, hue=248, saturation=142, value_scale=0.58)
    recolored = recolor_hsv(recolored, pants, hue=106, saturation=58, value_scale=0.72)
    recolored = recolor_hsv(recolored, red_accents, hue=248, saturation=158, value_scale=0.68)

    recolored_pixels = np.asarray(recolored).copy()
    original_pixels = np.asarray(original)
    preserved = skin_preserve | card_preserve
    recolored_pixels[preserved] = original_pixels[preserved]
    recolored = Image.fromarray(recolored_pixels, "RGBA")

    composed = recolored
    composed = add_round_glasses(composed)

    bbox = composed.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("Generated scholar sprite is fully transparent")
    margin = 18
    left = max(0, bbox[0] - margin)
    top = max(0, bbox[1] - margin)
    right = min(composed.width, bbox[2] + margin)
    bottom = min(composed.height, bbox[3] + margin)
    cropped = composed.crop((left, top, right, bottom))

    output.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(output, format="PNG", optimize=True)
    if source_copy:
        source_copy.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(source_copy, format="PNG", optimize=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the deterministic scholar-zombie fallback sprite.")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-copy", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    build(args.source, args.output, args.source_copy)
