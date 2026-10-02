from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "public"
for size in (192, 512):
    scale = size / 512
    image = Image.new("RGB", (size, size), "#172323")
    draw = ImageDraw.Draw(image)
    # Simple mark with safe space for Android maskable icons.
    draw.rectangle((int(126 * scale), int(150 * scale), int(386 * scale), int(205 * scale)), fill="#f6f7f2")
    draw.rectangle((int(226 * scale), int(150 * scale), int(284 * scale), int(370 * scale)), fill="#f6f7f2")
    draw.ellipse((int(336 * scale), int(322 * scale), int(400 * scale), int(386 * scale)), fill="#dbec83")
    image.save(root / f"icon-{size}.png", optimize=True)
