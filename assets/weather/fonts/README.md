# Local weather typography

- Manrope Variable: Fontsource variable package, weights 200–800; Latin, Latin Extended, Cyrillic, Greek and Vietnamese subsets.
- Noto Sans SC Variable: Fontsource variable package, weights 100–900; full Fontsource subset map for Simplified Chinese and supporting scripts.
- Both font families are self-hosted. No runtime Google Fonts, Fontsource CDN or other external font requests.
- Font files and CSS were sourced from https://github.com/fontsource/font-files at commit 5a72889057f592bb0659629e38337359f94d53b2.
- Font licenses are preserved alongside the font files (SIL Open Font License 1.1).
- CSS uses the local asset-base token __WEATHER_FONT_BASE__/; the extension entry and preview builder replace it with their local asset base at runtime/build time.
