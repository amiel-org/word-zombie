#!/usr/bin/env python3
"""Finalize generated battle artwork for the PWA asset pipeline."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFilter


def crop_alpha(image: Image.Image, padding: int) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Cannot crop a fully transparent image")

    left, top, right, bottom = bbox
    return rgba.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(rgba.width, right + padding),
            min(rgba.height, bottom + padding),
        )
    )


def save_png(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True, compress_level=9)


def restore_cannon_energy(source: Image.Image, keyed: Image.Image) -> Image.Image:
    """Restore the deliberately green energy chamber removed by chroma keying."""
    source_rgba = source.convert("RGBA")
    restored = keyed.convert("RGBA")
    mask = Image.new("L", source_rgba.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(
        (
            (430, 306),
            (470, 276),
            (622, 274),
            (680, 326),
            (678, 436),
            (638, 472),
            (454, 476),
            (414, 442),
            (408, 344),
        ),
        fill=255,
    )
    restored.paste(source_rgba, (0, 0), mask)
    return restored


def restore_zombie_patch(source: Image.Image, keyed: Image.Image) -> Image.Image:
    """Restore the green fabric patch on the hoodie without restoring the backdrop."""
    source_rgba = source.convert("RGBA")
    restored = keyed.convert("RGBA")
    mask = Image.new("L", source_rgba.size, 0)
    ImageDraw.Draw(mask).polygon(
        ((558, 532), (617, 521), (630, 621), (565, 638)),
        fill=255,
    )
    restored.paste(source_rgba, (0, 0), mask)
    return restored


def finalize(project: Path) -> None:
    public = project / "public" / "assets" / "battle"
    source = project / "assets-source" / "battle"
    scratch = project / "tmp" / "battle-assets"
    source.mkdir(parents=True, exist_ok=True)

    with Image.open(public / "campus-heritage-battlefield.png") as image:
        image.convert("RGB").save(
            public / "cultural-heritage-field.jpg",
            format="JPEG",
            quality=90,
            optimize=True,
            progressive=True,
            subsampling=1,
        )

    with Image.open(public / "campus-zombie-chroma.png") as source_image:
        with Image.open(scratch / "zombie-raw.png") as keyed_image:
            zombie = restore_zombie_patch(source_image, keyed_image)
            save_png(crop_alpha(zombie, padding=24), public / "zombie-scout.png")

    with Image.open(public / "word-cannon-base-chroma.png") as source_image:
        with Image.open(scratch / "cannon-raw.png") as keyed_image:
            cannon = restore_cannon_energy(source_image, keyed_image)
            save_png(crop_alpha(cannon, padding=24), public / "word-cannon-base.png")

    original_icon = source / "app-icon-source.png"
    shutil.copy2(public / "app-icon.png", original_icon)
    with Image.open(original_icon) as image:
        icon = image.convert("RGB")
        for size, name in (
            (1024, "app-icon.png"),
            (512, "app-icon-512.png"),
            (192, "app-icon-192.png"),
        ):
            resized = icon.resize((size, size), Image.Resampling.LANCZOS)
            save_png(resized.convert("RGBA"), public / name)

        background_patch = icon.crop((0, 0, min(500, icon.width), min(350, icon.height)))
        maskable = background_patch.resize((512, 512), Image.Resampling.LANCZOS)
        inset = icon.resize((400, 400), Image.Resampling.LANCZOS)
        blend_mask = Image.new("L", inset.size, 0)
        ImageDraw.Draw(blend_mask).rectangle((8, 8, 392, 392), fill=255)
        blend_mask = blend_mask.filter(ImageFilter.GaussianBlur(8))
        maskable.paste(inset, (56, 56), blend_mask)
        save_png(maskable.convert("RGBA"), public / "app-icon-maskable-512.png")

    for name in (
        "campus-heritage-battlefield.png",
        "campus-zombie-chroma.png",
        "word-cannon-base-chroma.png",
    ):
        destination = source / name
        if destination.exists():
            destination.unlink()
        shutil.move(str(public / name), str(destination))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--project",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    args = parser.parse_args()
    finalize(args.project.resolve())


if __name__ == "__main__":
    main()
