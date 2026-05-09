# Codex Pet Desk

A small cross-platform desktop pet shell for Codex-compatible pet packages.

Codex pet packages use this layout:

```text
pet-name/
├── pet.json
└── spritesheet.webp
```

The spritesheet follows the Codex atlas contract: `1536x1872`, 8 columns, 9 rows, `192x208` cells, with transparent unused cells.

## Features

- Transparent, always-on-top desktop window.
- Loads Codex `pet.json` manifests and PNG/WebP spritesheets.
- Auto-detects pets installed under `${CODEX_HOME:-$HOME/.codex}/pets/` when running as a Tauri app.
- Supports the standard Codex animation rows: idle, directional running, waving, jumping, failed, waiting, running, and review.
- Works without an image processing dependency because the WebView renders the spritesheet directly.
- Designed for Tauri, so the same app can be built for Windows, macOS, and Linux.

## Run

Install dependencies:

```bash
npm install
```

Start the desktop app:

```bash
npm run tauri:dev
```

Build release bundles:

```bash
npm run tauri:build
```

## Load A Pet

Use `Open pet` and select both `pet.json` and its referenced spritesheet, or use `Open folder` and choose the whole pet package folder. Dragging both files onto the window also works.

The expected manifest shape is:

```json
{
  "id": "pet-name",
  "displayName": "Pet Name",
  "description": "One short sentence.",
  "spritesheetPath": "spritesheet.webp"
}
```
