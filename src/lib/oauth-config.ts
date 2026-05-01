/**
 * OAuth configuration for the two providers Harness depends on.
 *
 * Codex values mirror the openai/codex CLI verbatim so a Harness sign-in is
 * indistinguishable from the codex CLI sign-in (same client_id, same callback
 * shape). Sourced from openai/codex @ codex-rs/login/src/auth/manager.rs and
 * codex-rs/login/src/server.rs.
 */

export const CODEX_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  /** Codex CLI listens on this port for the redirect; fallback is 1457. */
  callbackPort: 1455,
  fallbackPort: 1457,
  redirectPath: '/auth/callback',
  refreshTokenUrl: 'https://auth.openai.com/oauth/token',
  revokeTokenUrl: 'https://auth.openai.com/oauth/revoke',
  /** PKCE flow, scopes match the codex CLI default sign-in. */
  flow: 'pkce' as const,
} as const

export const codexRedirectUri = (port: number = CODEX_OAUTH.callbackPort) =>
  `http://localhost:${port}${CODEX_OAUTH.redirectPath}`

/**
 * GitHub OAuth — values populated from env on the server.
 * Phase 2 will read these from process.env at request time.
 */
export const GITHUB_OAUTH = {
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  apiBase: 'https://api.github.com',
  defaultScopes: ['repo', 'read:user'] as const,
  /** Mounted by our TanStack Start server route in phase 2. */
  callbackPath: '/api/auth/github/callback',
} as const
