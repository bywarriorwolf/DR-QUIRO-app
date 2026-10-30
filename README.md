# DR·QUIRO Reportes

A desktop app for the DR·QUIRO clinic. It turns patient photos plus a short form into a finished
**Reporte Inicial** or **Reporte Comparativo** in Canva. For each photo it removes the background
on the computer, places the person in the template slot with consistent margins, uploads the
photos, **copies** the right Canva template and fills in the copy. It never edits the template itself.

The UI is in Spanish and uses the Figma copy exactly. These docs are in English, except
[INSTALAR.md](INSTALAR.md), which is the end-user install guide in Spanish.

## Stack (and why)

| Piece | Choice | Why |
|---|---|---|
| Shell | **Electron 45** | One codebase builds a Windows `.exe` and a macOS `.dmg`. It ships Chromium, so the Figma-matched UI renders the same everywhere. `safeStorage` encrypts the OAuth tokens with the OS keychain or DPAPI. |
| Language | **TypeScript 7** (strict) | The main process, preload, renderer and tests all use one language, with one set of types shared across IPC. |
| UI | **React 19 + Vite 8** | Fast dev loop with small components. The CSS is plain and tokenised (`src/shared/theme.ts`), with no UI framework to fight. |
| Canva | **@modelcontextprotocol/sdk 1.32** | Canva's official MCP server (`https://mcp.canva.com/mcp`). The SDK implements OAuth 2.1 with PKCE and dynamic client registration, so the app ships no client secret. |
| Background removal | **onnxruntime-node + isnet-general-use** (Apache-2.0) | Runs on the CPU in the main process, with no Python sidecar to install and no cloud service, so photos never leave the machine. RMBG/BRIA models were ruled out because of their non-commercial licence. |
| Images | **sharp 0.35** | Fast decode, resize, greyscale and PNG encode, with prebuilt binaries for win32-x64, darwin-x64 and darwin-arm64. |
| Validation | **zod 4** | Every IPC payload and every Canva tool response is parsed against a schema. |
| Tests | **vitest 4**, **Playwright 1.64** | Unit and golden tests, plus end-to-end screenshots of the real Electron app in mock mode. |
| Packaging | **electron-builder 26** | Builds an NSIS per-user installer, a portable exe and a dmg. An `afterPack` hook prunes the ONNX Runtime and sharp binaries down to the target OS/arch. |

ONNX Runtime 1.31 dropped darwin-x64, so Intel Macs use the npm alias
`onnxruntime-node-darwin-x64` (= onnxruntime-node 1.23.2). The choice is made at runtime in
`src/main/photos/bgremove.ts`.

## Getting started

```bash
npm install
npm run model          # downloads isnet-general-use.onnx (~179 MB, SHA-256 verified) into resources/models/
npm run dev            # Vite + Electron with hot reload
npm run start:mock     # build output, Canva mocked (no network, nothing created in Canva)
```

Node 24 or later is recommended. The model file is git-ignored and is never committed.

### Mock mode (env vars)

| Var | Effect |
|---|---|
| `DRQUIRO_MOCK_CANVA=1` | Uses an in-memory Canva MCP that mirrors the real templates' structure. The slot PNGs are written to `<userData>/mock-output/<timestamp>/` so you can inspect them. |
| `DRQUIRO_MOCK_CONNECTED=1` | Starts already "connected". |
| `DRQUIRO_MOCK_FAIL_TOOL=<tool>` | Makes that tool fail, to exercise the error modal and the transaction cancel. |
| `DRQUIRO_MOCK_DELAY_MS`, `DRQUIRO_MOCK_IMPORT_DELAY_MS` | Slow things down so the loaders are visible. |
| `DRQUIRO_MOCK_NO_OPEN=1` | Doesn't open the browser when "Revisar documento" is clicked. |
| `DRQUIRO_USER_DATA=<dir>` | Isolated userData dir (used by tests and screenshots). |

## Tests and visual checks

```bash
npm run typecheck
npm test                                   # unit tests in 7 files
npm run contact-sheet -- tests/fixtures/cutouts <photo-dir>   # artifacts/contact-sheet.png
npm run screenshots                        # artifacts/screenshots/01..17 (Playwright + Electron, mock mode)
```

- `tests/canvaOps.test.ts`: the operation builder against the mock structure of both templates (slots, cover text, title, injuries).
- `tests/pipeline.test.ts`: golden geometry. The person is 80 % of the slot height, at most 90 % of the width, centred, with feet on the 90 % baseline. Comparativo pairs share the smaller scale. Inicial photos are B&W with alpha kept; Final photos are colour.
- `tests/bgremove.test.ts`: runs the real model on sample photos. It is skipped if the model or photos are missing (set `DRQ_SAMPLE_PHOTOS` to choose the photos).
- `tests/photoStore.test.ts`: magic-byte checks, generated names, path-traversal, symlink and NUL rejection.
- `tests/auth.test.ts`: the token store (via a fake safeStorage), the loopback callback server and the OAuth provider.

## Configuration

Everything you are likely to tune lives in three files:

- `src/shared/config.ts`: template IDs, protected design IDs, OAuth scopes, title pattern, slot geometry, layout fractions, photo limits and the model URL/hash.
- `src/shared/strings.ts`: every Spanish UI string.
- `src/shared/theme.ts`: colours and radii.

The upload spinner is `src/renderer/assets/loader.png`. The "Creando Documento" modal plays the animated `src/renderer/assets/baby-yoda-waiting.gif`. The icon is generated by `npm run icon` into `build/icon.png`.

## Packaging

```bash
npm run dist:win     # release/DR-QUIRO-Reportes-Setup-<v>.exe (NSIS, per-user) + DR-QUIRO-Reportes-Portable-<v>.exe
npm run dist:mac     # release/DR-QUIRO-Reportes-<v>-x64.dmg and -arm64.dmg (unsigned, not notarized)
npm run dist:linux   # release/linux-unpacked (dev smoke test only)
```

Build each OS on that OS. The NSIS installer needs Wine when it is built from Linux, but the portable exe does not.
The macOS build needs the darwin-x64 sharp packages, which the CI installs. See `.github/workflows/build.yml`.

### CI

`.github/workflows/build.yml` has three jobs:

1. `test` (ubuntu) runs the typecheck and tests.
2. `build` uses a matrix of `windows-latest` and `macos-latest`. It caches and downloads the model, runs `dist:win` or `dist:mac`, and uploads the installers as workflow artifacts.
3. On a `v*` tag, a `release` job attaches every installer to a **draft** GitHub Release.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload exposes a narrow API, and every IPC message is checked with zod in the main process.
- There is a strict CSP and no remote content. Navigation and `window.open` are blocked, and the only link the renderer can open is an `https://(www.)canva.com` URL (zod-checked). The OAuth URL comes from the SDK in the main process.
- Imported photos are accepted only by magic bytes (PNG or JPEG). They are copied into a private temp dir under UUID names, and renderer paths are never trusted (no path traversal, symlinks or NUL characters).
- Canva tokens and the dynamic client registration are encrypted with Electron `safeStorage`. "Desconectar Canva" deletes them. Tokens are never logged.
- Template originals and the example design are on a protected-ID list. The app only ever calls `copy-design` on templates and refuses to edit a protected ID.

More detail: [docs/architecture.md](docs/architecture.md), [docs/canva-flow.md](docs/canva-flow.md),
[docs/figma-deviations.md](docs/figma-deviations.md).
