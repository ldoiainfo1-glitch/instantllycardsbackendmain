# Ad Assets

Drop your ad creative images here, then run the upload script.

## Expected files

- `bottom.jpg` (or `.png` / `.webp`) — the carousel bottom-banner image
- `fullscreen.jpg` (or `.png` / `.webp`) — the full-screen modal image

The script auto-detects the extension. If you have multiple files, they will be matched by the **base name before the dot**.

## Why two images?

The mobile app filters `creative_urls`:
- A URL containing `/bottom` is shown in the carousel
- A URL containing `/fullscreen` is shown when the user taps it

Both must be present or the ad will not display correctly.

## Recommended dimensions

- **bottom**: 1200×400 px (3:1 banner aspect)
- **fullscreen**: 1080×1920 px (9:16 portrait)

Keep each image under ~500 KB for fast loading. JPEG quality 80–85 works well.

## Upload + create

```powershell
cd d:\Instantlly\Instantlly-Main-Project\instantllycardsbackendmain

$env:AD_TITLE        = "Diwali Mega Sale"
$env:AD_USER_ID      = "1"
$env:AD_PHONE        = "+919999999999"   # business owner ka number
$env:AD_DESCRIPTION  = "Up to 50% off"
$env:AD_CTA          = "https://yoursite.com/diwali"
$env:AD_DRY_RUN      = "1"               # preview first

npx ts-node scripts/uploadAndCreateAd.ts
```

After dry-run looks correct, set `$env:AD_DRY_RUN = "0"` and re-run.
