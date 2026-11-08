"""Bundle four credited, high-resolution weather photographs as portrait WebP.

Run only during asset refresh, never from the SillyTavern runtime.
Input URLs are original-size/download endpoints, not page preview thumbnails.
"""
from io import BytesIO
from pathlib import Path
import urllib.request
from PIL import Image, ImageOps

OUT = Path(__file__).resolve().parents[1] / "assets" / "weather"
# Original downloadable photograph endpoint; no width/height parameters or thumbnails.
PHOTOS = {
    "day": {
        "url": "https://images.pexels.com/photos/16459932/pexels-photo-16459932.jpeg?cs=srgb&fm=jpg",
        "page": "https://www.pexels.com/photo/a-white-clouds-against-blue-sky-16459932/",
        "author": "Abeer H", "center": (0.5, 0.43),
    },
    "dusk": {
        "url": "https://images.unsplash.com/photo-1757665669682-b2489e61569a?fm=jpg&q=95",
        "page": "https://unsplash.com/photos/pink-sunset-over-a-calm-ocean-beach-vrhEQC0CC5Q",
        "author": "Hannah Reding", "center": (0.5, 0.54),
    },
    "night": {
        "url": "https://images.unsplash.com/photo-1516166328576-82e16a127024?fm=jpg&q=95",
        "page": "https://unsplash.com/photos/a-large-cloud-with-stars-in-the-sky-CG7YwmRDGvI",
        "author": "Nacho Rochon", "center": (0.5, 0.4),
    },
    "rain": {
        "url": "https://images.pexels.com/photos/27378397/pexels-photo-27378397.jpeg?cs=srgb&fm=jpg",
        "page": "https://www.pexels.com/photo/a-close-up-of-rain-drops-on-a-window-27378397/",
        "author": "Betül Batmaz", "center": (0.5, 0.47),
    },
}

def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; PocketPhoneWeatherAssets/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=90) as response:
        data = response.read(35 * 1024 * 1024)
        content_type = response.headers.get("Content-Type", "")
        if not content_type.startswith("image/"):
            raise ValueError(f"Source did not return an image: {url} ({content_type})")
        return data

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    credits = ["# Weather photograph credits",
               "All four photographs are free to use under the respective Unsplash or Pexels license.",
               "Full-size originals are fetched directly at asset-generation time; bundled derivatives are not hotlinked.",
               "Target crop is 1000 × 1780 pixels (~9:16) at WebP quality 89 (method 6).", ""]
    for name, meta in PHOTOS.items():
        data = fetch(meta["url"])
        if len(data) < 120_000:
            raise ValueError(f"{name}: unexpectedly small source file ({len(data)} bytes)")
        with Image.open(BytesIO(data)) as original:
            original = ImageOps.exif_transpose(original)
            width, height = original.size
            if min(width, height) < 1450 or max(width, height) < 2200:
                raise ValueError(f"{name}: not a full-resolution original: {width}×{height}")
            photo = ImageOps.fit(original.convert("RGB"), (1000, 1780),
                                 method=Image.Resampling.LANCZOS, centering=meta["center"])
            target = OUT / (name + ".webp")
            photo.save(target, "WEBP", quality=89, method=6)
            size = target.stat().st_size
            if size < 45_000 or size > 3_000_000:
                raise ValueError(f"{name}: unexpected derivative size: {size}")
            print(f"{name}: source {width}x{height}, {len(data):,} bytes -> 1000x1780 WebP {size:,} bytes")
            credits.append(f"- **{name}.webp**: {meta['author']} — {meta['page']} (source {width} × {height}; WebP {size:,} bytes)")
    (OUT / "SOURCES.md").write_text("\n".join(credits) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
