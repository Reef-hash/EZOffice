# App Icons for electron-builder

This directory contains the app icons used in the Windows installer and application.

## Required Files

**For Windows:**
- `icon.ico` (256x256 or larger, 32-bit with alpha) — app icon in Explorer/taskbar
- `icon.png` (512x512, optional) — source for generating .ico if not manually created

**Current Status:**
electron-builder will generate a default icon if these files don't exist. For production, replace with actual EZOffice branding:
- Company logo (preferred 512x512)
- Color scheme: Indigo/Ink (per design system)

## How to Generate

1. Start with a 512x512 PNG image of the EZOffice logo
2. Use an online converter (icoconvert.com) or ImageMagick:
   ```
   convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
   ```
3. Save as `icon.ico` in this directory

## Next Steps (Future)

- Create custom EZOffice app icon
- Add installer background (optional, for branding)
- Update installer wizard text (in package.json `build.nsis` config)
