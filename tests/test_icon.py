import unittest

from scripts.generate_icon import (
    ASSETS,
    ICON_SIZE,
    ICO_SIZES,
    SOURCE,
    build_icon,
    crop_source,
)
from PIL import Image


class IconGenerationTests(unittest.TestCase):
    def test_generated_source_is_cropped_to_a_square(self):
        with Image.open(SOURCE) as source:
            cropped = crop_source(source)
        self.assertEqual(cropped.width, cropped.height)
        self.assertLess(cropped.width, source.width)

    def test_final_icon_has_transparent_corners_and_an_opaque_center(self):
        icon = build_icon()
        self.assertEqual(icon.size, (ICON_SIZE, ICON_SIZE))
        self.assertEqual(icon.mode, "RGBA")
        self.assertEqual(icon.getpixel((0, 0))[3], 0)
        self.assertEqual(icon.getpixel((ICON_SIZE // 2, ICON_SIZE // 2))[3], 255)

    def test_ico_contains_all_windows_icon_sizes(self):
        with Image.open(ASSETS / "icon.ico") as icon:
            self.assertEqual(set(icon.ico.sizes()), set(ICO_SIZES))


if __name__ == "__main__":
    unittest.main()
