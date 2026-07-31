"""Crop the generated brand artwork into tracked PNG/ICO app icons."""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design" / "branding" / "icon-source.png"
ASSETS = ROOT / "app" / "assets"
ICON_SIZE = 512
ICO_SIZES = [
    (16, 16),
    (20, 20),
    (24, 24),
    (32, 32),
    (40, 40),
    (48, 48),
    (64, 64),
    (128, 128),
    (256, 256),
]


def crop_source(source: Image.Image) -> Image.Image:
    """Return the square icon composition from the larger generated artboard."""
    width, height = source.size
    shortest = min(width, height)
    side = round(shortest * 0.718)
    left = (width - side) // 2
    top = round(height * 0.144)
    if top + side > height:
        top = height - side
    return source.crop((left, top, left + side, top + side))


def build_icon(source_path: Path = SOURCE) -> Image.Image:
    with Image.open(source_path) as source:
        cropped = crop_source(source.convert("RGBA"))
        icon = cropped.resize(
            (ICON_SIZE, ICON_SIZE),
            Image.Resampling.LANCZOS,
        )

    # Windows displays icons against both light and dark surfaces. A transparent
    # rounded-square silhouette keeps the warm artboard while avoiding hard,
    # opaque corners.
    mask = Image.new("L", icon.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, ICON_SIZE - 1, ICON_SIZE - 1),
        radius=104,
        fill=255,
    )
    icon.putalpha(ImageChops.multiply(icon.getchannel("A"), mask))
    return icon


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    image = build_icon()
    image.save(ASSETS / "icon.png", optimize=True)
    image.save(
        ASSETS / "icon.ico",
        sizes=ICO_SIZES,
    )


if __name__ == "__main__":
    main()
