/**
 * Encrypted persistence of the Canva OAuth state (client registration, tokens,
 * discovery metadata) using Electron's safeStorage (DPAPI on Windows,
 * Keychain on macOS). If OS encryption is unavailable nothing is written to
 * disk: the session simply lasts until the app quits (secure default).
 * Tokens are never logged.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export interface AuthData {
  clientInformation?: OAuthClientInformationMixed;
  /** Loopback port the client was registered with (redirect URIs must match). */
  redirectPort?: number;
  tokens?: OAuthTokens;
  discoveryState?: OAuthDiscoveryState;
  accountName?: string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
}

export interface SecretStore {
  load(): Promise<AuthData>;
  save(data: AuthData): Promise<void>;
  clear(): Promise<void>;
  readonly persistent: boolean;
}

export class MemorySecretStore implements SecretStore {
  private data: AuthData = {};
  readonly persistent = false;
  async load() {
    return structuredClone(this.data);
  }
  async save(d: AuthData) {
    this.data = structuredClone(d);
  }
  async clear() {
    this.data = {};
  }
}

export class EncryptedFileSecretStore implements SecretStore {
  private memory: AuthData | null = null;
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  get persistent(): boolean {
    return this.safe.isEncryptionAvailable();
  }

  async load(): Promise<AuthData> {
    if (this.memory) return structuredClone(this.memory);
    if (!this.persistent) return {};
    try {
      const enc = await fs.readFile(this.file);
      this.memory = JSON.parse(this.safe.decryptString(enc)) as AuthData;
    } catch {
      this.memory = {};
    }
    return structuredClone(this.memory);
  }

  async save(data: AuthData): Promise<void> {
    this.memory = structuredClone(data);
    if (!this.persistent) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, this.safe.encryptString(JSON.stringify(data)), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async clear(): Promise<void> {
    this.memory = {};
    await fs.rm(this.file, { force: true });
  }
}
