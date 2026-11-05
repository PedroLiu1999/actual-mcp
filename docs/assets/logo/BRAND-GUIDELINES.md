# actual-mcp — Brand & Logo Guidelines

## 1. The Logo
- **Concept**: *The Agent Spark*
- **Idea**: The iconic Actual Budget architectural drafting 'A' embedding an autonomous agent sparkle (the Google Gemini AI spark) nestled in its apex window.
- **Versions**:
  - `actual-mcp-horizontal.svg` — Primary horizontal lockup for documentation, README banners, and web headers.
  - `actual-mcp-stacked.svg` — Centered lockup for splash screens, presentations, and cards.
  - `actual-mcp-symbol.svg` — Master vector symbol for standalone use.
  - `actual-mcp-symbol-app-icon.svg` — White mark on Actual Budget purple squircle tile (512×512).
  - `actual-mcp-symbol-favicon.svg` — Optimized tight crop for browser tabs.

## 2. Clear Space
Keep a clear zone of **1 × [X]** around the logo on all sides, where **[X]** equals the height of the autonomous spark inside the symbol. No text, UI borders, or graphic elements should intrude into this zone.

## 3. Minimum Sizes
| Version | Digital / Screen | Print |
|---|---|---|
| Horizontal Lockup | 120 px wide | 30 mm wide |
| Stacked Lockup | 90 px wide | 22 mm wide |
| Symbol | 16 px (use `actual-mcp-symbol-favicon.svg`) | 6 mm |

## 4. Color Palette
| Role | Name | HEX | RGB | Use Case |
|---|---|---|---|---|
| Primary Brand | Actual Purple | `#6B46C1` | `rgb(107, 70, 193)` | Symbol, brand accents, app tile |
| Dark Neutral | Slate Ink | `#0F172A` | `rgb(15, 23, 42)` | Wordmark "actual", one-color black version |
| Subtitle / Gray | Muted Slate | `#64748B` | `rgb(100, 116, 139)` | "MODEL CONTEXT PROTOCOL" descriptor |
| Light Surface | Clean White | `#FFFFFF` | `rgb(255, 255, 255)` | Reverse mark on dark/purple, app icon foreground |
| Background | Soft Canvas | `#F8FAFC` | `rgb(248, 250, 252)` | Background tint for documentation and mockups |

**Approved Combinations**:
- Primary color lockup on pure white (`#FFFFFF`) or soft canvas (`#F8FAFC`).
- One-color reversed white on Actual Purple (`#6B46C1`) or Dark Slate (`#0F172A`).
- One-color solid black (`#000000` or `#0F172A`) on light backgrounds.

## 5. Typography
- **Wordmark Primary**: Modern geometric sans (`actual` set in Weight 500 / Medium; `mcp` set in Weight 800 / Extrabold).
- **Secondary Tagline**: System UI geometric sans set in Weight 600 / Semibold, uppercase, letter-spacing +3.5px.
- **Font Stack**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

## 6. Rules & Misuse
- **Do not** stretch, skew, or distort the mark.
- **Do not** reposition or enlarge the spark so it touches the outer A-frame.
- **Do not** recolor the spark in a clashing color; it should remain unified with the frame or in high-contrast white.
- **Do not** add drop shadows, outer glows, or bevel filters.
- **Do not** alter the slant angle (-21°) of the drafting crossbar.

## 7. Deliverables & Directory Layout
All production master files are organized under `docs/assets/logo/dist/`:
```text
docs/assets/logo/
├── dist/
│   ├── actual-mcp-symbol-black.svg
│   ├── actual-mcp-symbol-white.svg
│   ├── actual-mcp-symbol-mono-6b46c1.svg
│   ├── actual-mcp-symbol-app-icon.svg
│   ├── actual-mcp-symbol-favicon.svg
│   ├── actual-mcp-symbol-square.svg
│   ├── actual-mcp-horizontal.svg
│   ├── actual-mcp-horizontal-black.svg
│   ├── actual-mcp-horizontal-white.svg
│   ├── actual-mcp-horizontal-mono-6b46c1.svg
│   ├── actual-mcp-stacked.svg
│   ├── favicon.ico
│   ├── apple-touch-icon.png
│   ├── icon-192.png / icon-512.png / maskable-512.png
│   ├── site.webmanifest / head-snippet.html
│   └── [PNG ladders at 32, 64, 128, 256, 512, 1200 px]
├── slides/
│   ├── slide-01.png ... slide-05.png
├── presentation.html
└── BRAND-GUIDELINES.md
```
