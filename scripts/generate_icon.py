"""Generate the tracked PNG/ICO application icon without external assets."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "assets"


def build_icon() -> Image.Image:
    scale = 4
    size = 512
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def box(values: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        return tuple(value * scale for value in values)

    draw.rounded_rectangle(
        box((20, 20, 492, 492)),
        radius=112 * scale,
        fill="#FFF8E9",
        outline="#E9D9BD",
        width=10 * scale,
    )
    draw.ellipse(box((45, 330, 467, 610)), fill="#5A3828")

    potato = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    potato_draw = ImageDraw.Draw(potato)
    potato_draw.rounded_rectangle(
        box((154, 132, 376, 405)),
        radius=98 * scale,
        fill="#E95E4D",
        outline="#B93F34",
        width=12 * scale,
    )
    potato_draw.ellipse(box((215, 205, 235, 225)), fill="#B93F34")
    potato_draw.ellipse(box((286, 290, 310, 314)), fill="#B93F34")
    potato_draw.ellipse(box((213, 332, 228, 347)), fill="#F58A78")
    potato = potato.rotate(-21, resample=Image.Resampling.BICUBIC)
    canvas.alpha_composite(potato)

    draw = ImageDraw.Draw(canvas)
    draw.line(
        [(282 * scale, 167 * scale), (263 * scale, 102 * scale)],
        fill="#34745A",
        width=18 * scale,
    )
    draw.ellipse(box((198, 70, 271, 132)), fill="#4D936F", outline="#34745A", width=7 * scale)
    draw.ellipse(box((263, 58, 344, 125)), fill="#66A97F", outline="#34745A", width=7 * scale)

    draw.line(
        [(401 * scale, 132 * scale), (359 * scale, 318 * scale)],
        fill="#6E5543",
        width=18 * scale,
    )
    draw.rounded_rectangle(
        box((370, 98, 428, 151)),
        radius=20 * scale,
        outline="#6E5543",
        width=13 * scale,
    )
    draw.polygon(
        [
            (331 * scale, 307 * scale),
            (382 * scale, 319 * scale),
            (351 * scale, 381 * scale),
            (313 * scale, 350 * scale),
        ],
        fill="#D7C3A5",
        outline="#6E5543",
    )

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    image = build_icon()
    image.save(ASSETS / "icon.png")
    image.save(
        ASSETS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
