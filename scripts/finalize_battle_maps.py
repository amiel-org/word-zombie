from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "assets-source" / "battle" / "maps" / "generated"
OUTPUT = ROOT / "public" / "assets" / "battle" / "maps"
TARGET_SIZE = (1536, 960)

MAP_SOURCES = {
    "heritage-field.jpg": ROOT / "public" / "assets" / "battle" / "cultural-heritage-field.jpg",
    "library-autumn.jpg": GENERATED / "map-library-autumn.png",
    "athletics-summer.jpg": GENERATED / "map-athletics-summer.png",
    "science-rain.jpg": GENERATED / "map-science-rain.png",
    "winter-plaza.jpg": GENERATED / "map-winter-plaza.png",
    "academy-spring.jpg": GENERATED / "map-academy-spring.png",
    "seaside-campus.jpg": GENERATED / "map-seaside-campus.png",
    "greenhouse-rooftop.jpg": GENERATED / "map-greenhouse-rooftop.png",
}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for output_name, source in MAP_SOURCES.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        with Image.open(source) as image:
            prepared = ImageOps.fit(
                image.convert("RGB"),
                TARGET_SIZE,
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            destination = OUTPUT / output_name
            prepared.save(
                destination,
                format="JPEG",
                quality=88,
                optimize=True,
                progressive=True,
                subsampling="4:2:0",
            )
            print(f"{destination.relative_to(ROOT)}\t{destination.stat().st_size}")


if __name__ == "__main__":
    main()
