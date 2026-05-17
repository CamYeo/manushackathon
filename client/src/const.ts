export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// True when Manus OAuth env vars are configured on the frontend.
export const isOAuthConfigured = Boolean(
  import.meta.env.VITE_OAUTH_PORTAL_URL && import.meta.env.VITE_APP_ID
);

// Generate login URL at runtime so redirect URI reflects the current origin.
// Returns null when Manus OAuth env vars are missing (local dev without Manus).
export const getLoginUrl = (): string | null => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  // Guard: without Manus env vars we can't build a valid OAuth URL.
  if (!oauthPortalUrl || !appId) {
    return null;
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
