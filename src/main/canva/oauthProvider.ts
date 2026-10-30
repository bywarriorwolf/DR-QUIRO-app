/**
 * OAuthClientProvider for the MCP SDK: OAuth 2.1 authorization code + PKCE
 * with dynamic client registration as a *public* client
 * (token_endpoint_auth_method "none") and a loopback redirect URI.
 */
import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { CANVA } from '../../shared/config';
import type { SecretStore } from './secretStore';

export class NeedsLoginError extends Error {
  constructor() {
    super('Canva login required');
    this.name = 'NeedsLoginError';
  }
}

export interface ProviderOptions {
  /** Loopback redirect URL (http://127.0.0.1:<port>/callback). */
  redirectUrl: string;
  port: number;
  /** When false (silent reconnect at start-up) the browser is never opened. */
  interactive: boolean;
  openBrowser: (url: string) => Promise<void>;
}

export class CanvaOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  private expectedState: string | undefined;

  constructor(
    private readonly store: SecretStore,
    private readonly opts: ProviderOptions,
  ) {}

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CANVA.clientName,
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: CANVA.scopes.join(' '),
    };
  }

  state(): string {
    this.expectedState = randomBytes(24).toString('base64url');
    return this.expectedState;
  }

  /** The state value issued for the current authorization request. */
  currentState(): string | undefined {
    return this.expectedState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const d = await this.store.load();
    // A registration is only valid for the redirect URI it was made with.
    if (!d.clientInformation || d.redirectPort !== this.opts.port) return undefined;
    return d.clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const d = await this.store.load();
    await this.store.save({ ...d, clientInformation: info, redirectPort: this.opts.port });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const d = await this.store.load();
    await this.store.save({ ...d, tokens });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.opts.interactive) throw new NeedsLoginError();
    if (authorizationUrl.protocol !== 'https:') throw new Error('authorization URL must be https');
    await this.opts.openBrowser(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier; // memory only
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('no PKCE code verifier');
    return this.verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const d = await this.store.load();
    if (scope === 'all') return this.store.clear();
    if (scope === 'client') delete d.clientInformation;
    if (scope === 'tokens') delete d.tokens;
    if (scope === 'discovery') delete d.discoveryState;
    if (scope === 'verifier') this.verifier = undefined;
    await this.store.save(d);
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const d = await this.store.load();
    await this.store.save({ ...d, discoveryState: state });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.load()).discoveryState;
  }
}
