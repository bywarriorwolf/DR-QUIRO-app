/**
 * Canva connection: MCP client over Streamable HTTP with OAuth (PKCE + DCR,
 * public client, loopback redirect, system browser). Exposes `CanvaTools`
 * for the report runner.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { CANVA } from '../../shared/config';
import { startLoopback, type Loopback } from './loopback';
import { MockCanva } from './mock';
import { CanvaOAuthProvider, NeedsLoginError } from './oauthProvider';
import { parseAccountName, type ToolResultLike } from './parse';
import type { SecretStore } from './secretStore';
import { USER_INTENT, type CanvaTools } from './tools';

export const REQUIRED_TOOLS = [
  'copy-design',
  'start-editing-transaction',
  'perform-editing-operations',
  'commit-editing-transaction',
  'cancel-editing-transaction',
  'create-upload-url',
] as const;

export interface CanvaSession {
  readonly mock: boolean;
  isConnected(): boolean;
  accountName(): string | null;
  /** Reconnect with stored tokens, never opening a browser. */
  resume(): Promise<boolean>;
  /** Interactive login in the system browser. */
  login(): Promise<void>;
  /** Close the connection and delete every stored token. */
  logout(): Promise<void>;
  tools(): CanvaTools;
}

const VERSION = '1.0.0';
const TOOL_TIMEOUT_MS = 120_000;

export class McpCanvaSession implements CanvaSession {
  readonly mock = false;
  private client: Client | null = null;
  private name: string | null = null;
  private loginInFlight: Promise<void> | null = null;

  constructor(
    private readonly store: SecretStore,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  isConnected() {
    return this.client !== null;
  }
  accountName() {
    return this.name;
  }

  private async connectWith(provider: CanvaOAuthProvider): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const transport = new StreamableHTTPClientTransport(new URL(CANVA.mcpUrl), { authProvider: provider });
    const client = new Client({ name: 'dr-quiro-reportes', version: VERSION });
    await client.connect(transport);
    return { client, transport };
  }

  private async afterConnect(client: Client) {
    this.client = client;
    try {
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));
      const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
      if (missing.length) this.log(`Canva MCP: faltan herramientas: ${missing.join(', ')}`);
    } catch (e) {
      this.log(`Canva MCP: tools/list falló: ${(e as Error).message}`);
    }
    try {
      const res = (await client.callTool({ name: 'get-logged-in-account-details', arguments: { user_intent: USER_INTENT } })) as ToolResultLike;
      this.name = parseAccountName(res);
      const d = await this.store.load();
      await this.store.save({ ...d, accountName: this.name ?? undefined });
    } catch {
      this.name = (await this.store.load()).accountName ?? null;
    }
  }

  async resume(): Promise<boolean> {
    const d = await this.store.load();
    if (!d.tokens || !d.redirectPort) return false;
    const provider = new CanvaOAuthProvider(this.store, {
      redirectUrl: `http://127.0.0.1:${d.redirectPort}${CANVA.callbackPath}`,
      port: d.redirectPort,
      interactive: false,
      openBrowser: this.openBrowser,
    });
    try {
      const { client } = await this.connectWith(provider);
      await this.afterConnect(client);
      return true;
    } catch (e) {
      if (!(e instanceof NeedsLoginError || e instanceof UnauthorizedError)) this.log(`Canva: reconexión falló: ${(e as Error).message}`);
      return false;
    }
  }

  login(): Promise<void> {
    this.loginInFlight ??= this.doLogin().finally(() => (this.loginInFlight = null));
    return this.loginInFlight;
  }

  private async openLoopback(): Promise<Loopback> {
    const d = await this.store.load();
    if (d.redirectPort) {
      try {
        return await startLoopback(d.redirectPort);
      } catch {
        // Port taken: register a new client for a new port.
        await this.store.save({ ...d, clientInformation: undefined, redirectPort: undefined });
      }
    }
    return startLoopback(0);
  }

  private async doLogin(): Promise<void> {
    await this.closeClient();
    const loop = await this.openLoopback();
    try {
      const provider = new CanvaOAuthProvider(this.store, {
        redirectUrl: loop.redirectUrl,
        port: loop.port,
        interactive: true,
        openBrowser: this.openBrowser,
      });
      try {
        const { client } = await this.connectWith(provider);
        await this.afterConnect(client); // stored tokens were still valid
        return;
      } catch (e) {
        if (!(e instanceof UnauthorizedError)) throw e;
      }
      // Browser is open on Canva's consent page; wait for the redirect.
      const code = await loop.waitForCode(() => provider.currentState());
      const finisher = new StreamableHTTPClientTransport(new URL(CANVA.mcpUrl), { authProvider: provider });
      await finisher.finishAuth(code);
      await finisher.close().catch(() => {});
      const { client } = await this.connectWith(provider);
      await this.afterConnect(client);
    } finally {
      loop.close();
    }
  }

  private async closeClient() {
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => {});
  }

  async logout(): Promise<void> {
    await this.closeClient();
    this.name = null;
    await this.store.clear();
  }

  tools(): CanvaTools {
    const client = this.client;
    if (!client) throw new UnauthorizedError('not connected');
    return {
      callTool: async (name, args) =>
        (await client.callTool({ name, arguments: args }, undefined, { timeout: TOOL_TIMEOUT_MS })) as ToolResultLike,
      upload: async (url, bytes) => {
        if (new URL(url).protocol !== 'https:') throw new Error('upload URL must be https');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(bytes),
          signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
        return body;
      },
    };
  }
}

/** Dry-run session (DRQUIRO_MOCK_CANVA=1): nothing leaves the computer. */
export class MockCanvaSession implements CanvaSession {
  readonly mock = true;
  private connected: boolean;
  readonly server: MockCanva;

  constructor(opts: { delayMs?: number; startConnected?: boolean; accountName?: string; failTool?: string } = {}) {
    this.server = new MockCanva({ delayMs: opts.delayMs, accountName: opts.accountName, failTool: opts.failTool });
    this.connected = opts.startConnected ?? true;
  }
  isConnected() {
    return this.connected;
  }
  accountName() {
    return this.connected ? this.server.accountName : null;
  }
  async resume() {
    return this.connected;
  }
  async login() {
    await new Promise((r) => setTimeout(r, 300));
    this.connected = true;
  }
  async logout() {
    this.connected = false;
  }
  tools(): CanvaTools {
    if (!this.connected) throw new UnauthorizedError('not connected');
    return this.server;
  }
}
