import { AuthConfig } from 'angular-oauth2-oidc';

export const authConfig: AuthConfig = {
  issuer: 'https://sts.windows.net/23aeccf7-37fe-407e-8ddf-3f5a66d2c5b5/',
  clientId: '88ce574c-7c5c-4d4b-b966-a161ef3c2e5b', // The "Auth Code + PKCE" client
  responseType: 'code',
  redirectUri: 'http://localhost:4200',//window.location.origin + '/index.html',
  silentRefreshRedirectUri: window.location.origin + '/silent-refresh.html',
  scope: 'openid profile email api', // Ask offline_access to support refresh token refreshes
  useSilentRefresh: true, // Needed for Code Flow to suggest using iframe-based refreshes
  silentRefreshTimeout: 5000, // For faster testing
  timeoutFactor: 0.25, // For faster testing
  sessionChecksEnabled: true,
  showDebugInformation: true, // Also requires enabling "Verbose" level in devtools
  clearHashAfterLogin: false, // https://github.com/manfredsteyer/angular-oauth2-oidc/issues/457#issuecomment-431807040,
  nonceStateSeparator : 'semicolon', // Real semicolon gets mangled by IdentityServer's URI encoding,
  strictDiscoveryDocumentValidation: false
};
