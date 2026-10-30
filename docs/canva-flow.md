# Canva flow

## Connection (OAuth 2.1 + PKCE, public client)

1. "Conectar Canva" starts a loopback HTTP server on `127.0.0.1`, choosing a port the first time. It serves only `/callback`.
2. The MCP SDK discovers Canva's authorization server and **dynamically registers** a public client (`token_endpoint_auth_method: none`) whose redirect URI is `http://127.0.0.1:<port>/callback`. The registration is stored, so later logins reuse the same port.
3. The authorization URL (with the PKCE `S256` challenge and a random `state`) opens in the **system browser**, never in an Electron window.
4. The callback checks `state`, and the SDK exchanges the code using the PKCE verifier (`finishAuth`), then reconnects.
5. Tokens and the client info are encrypted with `safeStorage` in `<userData>/canva-auth.bin`. Refresh is handled by the SDK. "Desconectar Canva" deletes the file.

Tokens are never logged.

## Creating a report (`src/main/canva/runner.ts`)

1. **Upload first.** Every slot PNG is uploaded through `create-upload-url` (4 in parallel, with retries) and the app waits for its asset ID. Uploading before copying means a failed upload never leaves a half-made design.
2. **Copy the template** with `copy-design`: `DAHZcKDyN90` (Inicial) or `DAHZcAKxsQg` (Comparativo). The originals are **never** opened for editing. `assertEditable` refuses any ID in `protectedDesignIds` (`DAHWWjbFWBs`, the real example, is also on that list).
3. **Edit inside a transaction**: `start-editing-transaction` on the copy, then `perform-editing-operations` batches built by `ops.ts`:
   - `find_and_replace_text` for the name and date placeholders on the cover, and for the four injury lines on page 11 when the template has those placeholders. The Inicial template does. The Comparativo template's page 11 is a closing page without them, so it is left unchanged even though the form still requires the injury text.
   - `insert_fill` with each uploaded asset into the photo slots on pages 4–10 (3 rows per page, in the user's drag order).
   - `update_title` → `REPORTE INICIAL|COMPARATIVO Nombre Apellido - Fecha - A5`.
4. `commit-editing-transaction`. On **any** error the transaction is cancelled with `cancel-editing-transaction`. The copy then stays in the user's Canva as an untouched duplicate of the template, because the Canva MCP has no delete tool. The log records its ID.
5. The UI shows "Completado", and "Revisar documento" opens the copy's edit URL (only `https://www.canva.com` URLs are allowed).

## Mock

With `DRQUIRO_MOCK_CANVA=1`, `canva/mock.ts` replaces the network session. It serves the recorded structure of both templates (`canva/fixtures/*.json`), validates the operations the way the real server does, and writes the uploaded PNGs and `ops.json` to `<userData>/mock-output/<ts>/`. `tests/canvaOps.test.ts` runs the builder against it.
