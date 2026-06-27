# Conchitour

Desktop editor for professional 360° virtual tours.
**Architect your virtual tours.**

## Quick start

```
npm install
npm run dev
```

The app opens automatically (Electron window). Hot reload works for the renderer.

## Project structure

See `CLAUDE.md` for the full architecture overview.

## Build a distributable

```
npm run build
```

Produces installers in `release/` for the current OS:
- Windows: `.exe` (NSIS)
- macOS: `.dmg`
- Linux: `.AppImage`

## krpano license

Drop your licensed krpano files into `assets/krpano/`. This folder is **gitignored** for safety.

## License

UNLICENSED — proprietary product. © Conchito.
