import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { MockCanvaSession } from '../src/main/canva/connection';
import { LoginCancelledError, startLoopback } from '../src/main/canva/loopback';
import { CanvaOAuthProvider, NeedsLoginError } from '../src/main/canva/oauthProvider';
import { EncryptedFileSecretStore, MemorySecretStore, type SafeStorageLike } from '../src/main/canva/secretStore';
import { errorCode } from '../src/main/errors';

const tmp = path.join(os.tmpdir(), `drq-auth-${process.pid}`);
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

/** Stand-in for Electron safeStorage: reversible XOR "encryption". */
const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
});
const TOKENS = { access_token: 'secret-access-TOKEN', token_type: 'Bearer', refresh_token: 'secret-refresh' };

describe('EncryptedFileSecretStore', () => {
  it('persists encrypted (no plaintext token on disk) and round-trips', async () => {
    const file = path.join(tmp, 'a', 'canva-auth.bin');
    await new EncryptedFileSecretStore(file, fakeSafe()).save({ tokens: TOKENS, redirectPort: 1234 });
    const raw = await fs.readFile(file);
    expect(raw.toString('latin1')).not.toContain('secret-access-TOKEN');
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const again = new EncryptedFileSecretStore(file, fakeSafe());
    expect((await again.load()).tokens?.access_token).toBe('secret-access-TOKEN');
  });
  it('"Desconectar" (clear) deletes the file', async () => {
    const file = path.join(tmp, 'b', 'canva-auth.bin');
    const s = new EncryptedFileSecretStore(file, fakeSafe());
    await s.save({ tokens: TOKENS });
    await s.clear();
    await expect(fs.stat(file)).rejects.toThrow();
    expect(await s.load()).toEqual({});
  });
  it('without OS encryption nothing is written (session lasts until quit)', async () => {
    const file = path.join(tmp, 'c', 'canva-auth.bin');
    const s = new EncryptedFileSecretStore(file, fakeSafe(false));
    await s.save({ tokens: TOKENS });
    expect(s.persistent).toBe(false);
    expect((await s.load()).tokens).toEqual(TOKENS);
    await expect(fs.stat(file)).rejects.toThrow();
  });
  it('a corrupt file is treated as logged out', async () => {
    const file = path.join(tmp, 'd', 'canva-auth.bin');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'garbage');
    expect(await new EncryptedFileSecretStore(file, fakeSafe()).load()).toEqual({});
  });
});

describe('loopback redirect server', () => {
  it('listens on 127.0.0.1 /callback and returns the code for the right state', async () => {
    const lb = await startLoopback();
    expect(lb.redirectUrl).toBe(`http://127.0.0.1:${lb.port}/callback`);
    const p = lb.waitForCode(() => 'good-state', 5000);
    expect((await fetch(`http://127.0.0.1:${lb.port}/other`)).status).toBe(404);
    expect((await fetch(`${lb.redirectUrl}?code=evil&state=forged`)).status).toBe(400); // keeps waiting
    const ok = await fetch(`${lb.redirectUrl}?code=abc123&state=good-state`);
    expect(ok.status).toBe(200);
    await expect(p).resolves.toBe('abc123');
  });
  it('an OAuth error (user pressed cancel) rejects with LoginCancelledError', async () => {
    const lb = await startLoopback();
    const p = expect(lb.waitForCode(() => 's', 5000)).rejects.toBeInstanceOf(LoginCancelledError);
    await fetch(`${lb.redirectUrl}?error=access_denied&state=s`);
    await p;
  });
  it('times out', async () => {
    const lb = await startLoopback();
    await expect(lb.waitForCode(() => 's', 50)).rejects.toBeInstanceOf(LoginCancelledError);
  });
});

describe('CanvaOAuthProvider', () => {
  const mk = (over: Partial<ConstructorParameters<typeof CanvaOAuthProvider>[1]> = {}, store = new MemorySecretStore()) => {
    const opened: string[] = [];
    const p = new CanvaOAuthProvider(store, {
      redirectUrl: 'http://127.0.0.1:4321/callback', port: 4321, interactive: true,
      openBrowser: async (u) => void opened.push(u), ...over,
    });
    return { p, opened, store };
  };
  it('registers as a public client with the loopback redirect', () => {
    const m = mk().p.clientMetadata;
    expect(m.token_endpoint_auth_method).toBe('none');
    expect(m.redirect_uris).toEqual(['http://127.0.0.1:4321/callback']);
    expect(m.grant_types).toContain('authorization_code');
  });
  it('state is random per request', () => {
    const { p } = mk();
    const a = p.state();
    const b = p.state();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(p.currentState()).toBe(b);
  });
  it('a registration made for another port is ignored', async () => {
    const { p, store } = mk();
    await p.saveClientInformation({ client_id: 'abc' });
    expect(await p.clientInformation()).toEqual({ client_id: 'abc' });
    const other = mk({ port: 9999, redirectUrl: 'http://127.0.0.1:9999/callback' }, store).p;
    expect(await other.clientInformation()).toBeUndefined();
  });
  it('opens only https authorization URLs, and never when non-interactive', async () => {
    const { p, opened } = mk();
    await p.redirectToAuthorization(new URL('https://www.canva.com/api/oauth/authorize?x=1'));
    expect(opened).toHaveLength(1);
    await expect(p.redirectToAuthorization(new URL('http://evil/'))).rejects.toThrow();
    await expect(mk({ interactive: false }).p.redirectToAuthorization(new URL('https://www.canva.com/'))).rejects.toBeInstanceOf(NeedsLoginError);
  });
  it('the PKCE verifier stays in memory; invalidate("all") wipes the store', async () => {
    const { p, store } = mk();
    p.saveCodeVerifier('v'.repeat(43));
    expect(p.codeVerifier()).toBe('v'.repeat(43));
    expect(JSON.stringify(await store.load())).not.toContain('vvvv');
    await p.saveTokens(TOKENS);
    await p.invalidateCredentials('tokens');
    expect(await p.tokens()).toBeUndefined();
    await p.saveTokens(TOKENS);
    await p.invalidateCredentials('all');
    expect(await store.load()).toEqual({});
  });
});

describe('mock Canva session & error codes', () => {
  it('connect / disconnect', async () => {
    const s = new MockCanvaSession({ startConnected: false, delayMs: 0 });
    expect(s.isConnected()).toBe(false);
    expect(() => s.tools()).toThrow(UnauthorizedError);
    await s.login();
    expect(s.isConnected()).toBe(true);
    expect(s.accountName()).toBeTruthy();
    await s.logout();
    expect(s.accountName()).toBeNull();
  });
  it('maps errors to user-facing codes', () => {
    expect(errorCode(new UnauthorizedError('x'))).toBe('notConnected');
    expect(errorCode(new NeedsLoginError())).toBe('notConnected');
    expect(errorCode(new LoginCancelledError())).toBe('loginCancelled');
    expect(errorCode(new TypeError('fetch failed'))).toBe('network');
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe('network');
    expect(errorCode(new Error('boom'))).toBe('unknown');
  });
});
