# Architecture

```
renderer (React, sandboxed)  ──window.drquiro (preload, contextBridge)──▶  main process (Node)
   src/renderer/*                 src/preload/preload.ts                     src/main/main.ts
                                  narrow typed API, no Node                  zod-validates every IPC payload
```

## Processes

- **Renderer** (`src/renderer`): React UI matching the Figma. It has no Node access and runs under a CSP with no remote content. It only refers to photos by opaque IDs and thumbnails (data URLs) returned by main.
- **Preload** (`src/preload/preload.ts`, bundled as CJS): exposes `window.drquiro` with one method per IPC channel (`src/shared/channels.ts`).
- **Main** (`src/main`, bundled as ESM by esbuild with `sharp`/`onnxruntime-node` external):
  - `photos/store.ts`: imports files picked or dropped by the user. It resolves the real path, rejects symlinks, NUL characters and non-files, checks the size and the PNG/JPEG magic bytes (`photos/magic.ts`), and copies the file to a private temp dir as `<uuid>.png|jpg`. The renderer gets back only the ID.
  - `photos/bgremove.ts`: isnet-general-use through ONNX Runtime (1024² input, CPU). The session is created once and lazily. `enableCpuMemArena`/`enableMemPattern` are off, because with them a second inference inside Electron hits the V8 memory cage and crashes.
  - `photos/alpha.ts`: cleans the mask by keeping the main blobs, applying level thresholds, eroding 1 px and feathering slightly.
  - `photos/layoutMath.ts` + `photos/compose.ts`: place the cutout in a slot-shaped transparent PNG (825 px wide). The person is scaled to 80 % of the slot height, capped at 90 % of the width, centred horizontally, with the feet at 90 % of the height. In **Comparativo**, the Inicial and Final photos of each row use the **smaller** of their two scales, so the "after" photo is never larger. Inicial photos are greyscale with alpha kept; Final photos stay in colour.
  - `photos/pipeline.ts`: runs the steps above for every photo of the report.
  - `canva/*`: the Canva MCP client (see [canva-flow.md](canva-flow.md)).

## Shared code (`src/shared`)

- `config.ts`: all tunables.
- `strings.ts`: UI copy.
- `theme.ts`: colours.
- `dates.ts`: "Julio 08, 2026" formatting.
- `report.ts`: form validation, title/cover text and slot mapping.
- `ipc.ts`: zod schemas.

## Packaging notes

- `asarUnpack`: sharp, @img/*, onnxruntime-* (native `.node`/`.dll`/`.dylib` can't load from inside asar).
- The model is shipped as `extraResources` → `process.resourcesPath/models/isnet-general-use.onnx`.
- `scripts/after-pack.cjs` deletes ONNX Runtime binaries for other OSes, archs and CUDA, plus non-target `@img/sharp-*` packages. Without it, onnxruntime-node alone adds about 566 MB.
