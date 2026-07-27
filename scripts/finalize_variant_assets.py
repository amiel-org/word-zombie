#!/usr/bin/env python3
"""Convert chroma-key variants into cropped transparent assets and QA sheets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


QA_BACKGROUNDS = (
    ("light", (247, 248, 244)),
    ("dark", (18, 21, 28)),
    ("magenta", (180, 52, 116)),
)


def smoothstep(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, 0.0, 1.0)
    return clipped * clipped * (3.0 - 2.0 * clipped)


def sample_border_key(rgb: np.ndarray, band: int = 6) -> np.ndarray:
    top = rgb[:band, :, :].reshape(-1, 3)
    bottom = rgb[-band:, :, :].reshape(-1, 3)
    left = rgb[:, :band, :].reshape(-1, 3)
    right = rgb[:, -band:, :].reshape(-1, 3)
    samples = np.concatenate((top, bottom, left, right), axis=0)
    return np.rint(np.median(samples, axis=0)).astype(np.float32)


def remove_green_key(
    image: Image.Image,
    transparent_threshold: float = 20.0,
    opaque_threshold: float = 100.0,
) -> tuple[Image.Image, tuple[int, int, int]]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    key = sample_border_key(rgb)
    distance = np.max(np.abs(rgb - key), axis=2)

    distance_alpha = 255.0 * smoothstep(
        (distance - transparent_threshold) / (opaque_threshold - transparent_threshold)
    )
    green_dominance = rgb[:, :, 1] - np.maximum(rgb[:, :, 0], rgb[:, :, 2])
    key_dominance = max(1.0, float(key[1] - max(key[0], key[2])))
    dominance_alpha = 255.0 * np.clip(
        1.0 - (green_dominance - 16.0) / max(1.0, key_dominance - 16.0),
        0.0,
        1.0,
    )
    key_like = green_dominance >= 16.0
    alpha = np.where(key_like, np.minimum(distance_alpha, dominance_alpha), 255.0)
    alpha = np.where(alpha <= 8.0, 0.0, alpha)

    output_rgb = rgb.copy()
    edge = key_like & (alpha < 255.0)
    edge_anchor = np.maximum(output_rgb[:, :, 0], output_rgb[:, :, 2])
    output_rgb[:, :, 1] = np.where(
        edge,
        np.minimum(output_rgb[:, :, 1], edge_anchor),
        output_rgb[:, :, 1],
    )
    output_rgb[alpha == 0.0] = 0.0
    rgba = np.dstack((output_rgb, alpha)).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA"), tuple(int(round(value)) for value in key)


def crop_alpha(image: Image.Image, padding: int) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Chroma-key result is fully transparent")
    left, top, right, bottom = bbox
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def fit_canvas(image: Image.Image, size: tuple[int, int], inset: int = 24) -> Image.Image:
    available = (size[0] - inset * 2, size[1] - inset * 2)
    scale = min(available[0] / image.width, available[1] / image.height)
    fitted_size = (
        max(1, int(round(image.width * scale))),
        max(1, int(round(image.height * scale))),
    )
    fitted = image.convert("RGBa").resize(fitted_size, Image.Resampling.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    position = ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2)
    canvas.alpha_composite(fitted, position)
    return canvas


def despill_translucent(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"), copy=True)
    alpha = rgba[:, :, 3]
    anchor = np.maximum(rgba[:, :, 0], rgba[:, :, 2])
    green = rgba[:, :, 1]
    spill = (alpha < 255) & (green > anchor)
    rgba[:, :, 1] = np.where(spill, anchor, green)
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def alpha_stats(image: Image.Image) -> dict[str, int]:
    alpha = np.asarray(image.getchannel("A"))
    return {
        "pixels": int(alpha.size),
        "transparent": int(np.count_nonzero(alpha == 0)),
        "partial": int(np.count_nonzero((alpha > 0) & (alpha < 255))),
        "opaque": int(np.count_nonzero(alpha == 255)),
    }


def qa_sheet(image: Image.Image, title: str) -> Image.Image:
    cell_size = (420, 460)
    header = 42
    sheet = Image.new("RGB", (cell_size[0] * 3, cell_size[1] + header), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((14, 13), title, fill=(20, 22, 26))
    for index, (label, color) in enumerate(QA_BACKGROUNDS):
        panel = Image.new("RGBA", cell_size, color + (255,))
        fitted = fit_canvas(image, (cell_size[0], cell_size[1] - 28), inset=20)
        panel.alpha_composite(fitted, (0, 28))
        panel_draw = ImageDraw.Draw(panel)
        text_color = (245, 245, 245, 255) if label == "dark" else (25, 25, 28, 255)
        panel_draw.text((10, 8), label, fill=text_color)
        sheet.paste(panel.convert("RGB"), (index * cell_size[0], header))
    return sheet


def parse_asset(value: str) -> tuple[Path, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("asset must use SOURCE=DESTINATION")
    source, destination = value.split("=", 1)
    return Path(source), Path(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", action="append", type=parse_asset, required=True)
    parser.add_argument("--qa-dir", type=Path, required=True)
    parser.add_argument("--padding", type=int, default=24)
    parser.add_argument(
        "--weapon-canvas",
        default="1040x520",
        help="Transparent canvas for outputs whose destination starts with weapon-",
    )
    args = parser.parse_args()

    canvas_width, canvas_height = (int(part) for part in args.weapon_canvas.split("x", 1))
    args.qa_dir.mkdir(parents=True, exist_ok=True)
    report: list[dict[str, object]] = []

    for source, destination in args.asset:
        if not source.is_file():
            raise FileNotFoundError(source)
        with Image.open(source) as image:
            keyed, key = remove_green_key(image)
        cropped = crop_alpha(keyed, args.padding)
        final = (
            fit_canvas(cropped, (canvas_width, canvas_height))
            if destination.name.startswith("weapon-")
            else cropped
        )
        final = despill_translucent(final)
        destination.parent.mkdir(parents=True, exist_ok=True)
        final.save(destination, format="PNG", optimize=True, compress_level=9)

        qa_path = args.qa_dir / f"{destination.stem}-qa.jpg"
        qa_sheet(final, destination.name).save(
            qa_path,
            format="JPEG",
            quality=92,
            optimize=True,
            progressive=True,
        )
        report.append(
            {
                "source": str(source.resolve()),
                "destination": str(destination.resolve()),
                "key": "#{:02x}{:02x}{:02x}".format(*key),
                "source_size": list(keyed.size),
                "final_size": list(final.size),
                "bytes": destination.stat().st_size,
                "alpha": alpha_stats(final),
                "qa": str(qa_path.resolve()),
            }
        )

    report_path = args.qa_dir / "variant-assets-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path.resolve()), "assets": report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
