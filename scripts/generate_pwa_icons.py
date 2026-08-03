from pathlib import Path

from PIL import Image, ImageDraw


OUTPUT_DIR = Path(__file__).parents[1] / "public" / "icons"
SIZES = (180, 192, 512)


def make_icon(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), "#151814")
    draw = ImageDraw.Draw(image)
    inset = round(size * 0.12)
    corner = round(size * 0.22)
    draw.rounded_rectangle((0, 0, size, size), radius=corner, fill="#151814")
    left, top, right, bottom = inset, inset, size - inset, size - inset
    bookmark_bottom = bottom - round(size * 0.04)
    fold = round(size * 0.13)
    draw.polygon(
        [(left, top), (right, top), (right, bookmark_bottom), (size // 2, bookmark_bottom - fold), (left, bookmark_bottom)],
        fill="#e5f0e7",
    )
    line_left = left + round(size * 0.075)
    line_right = right - round(size * 0.075)
    line_top = top + round(size * 0.09)
    line_gap = round(size * 0.105)
    stroke = max(4, round(size * 0.043))
    for index, length in enumerate((line_right, line_right, line_left + round(size * 0.57))):
        y = line_top + index * line_gap
        draw.line((line_left, y, length, y), fill="#28583b", width=stroke)
    return image


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        make_icon(size).save(OUTPUT_DIR / f"quiet-reader-{size}.png")
