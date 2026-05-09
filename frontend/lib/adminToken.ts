/**
 * Client-side admin-token helpers.
 *
 * The admin page is gated behind a shared token (P-10.11). The flow:
 *   1. The admin URL is shared as `https://.../admin?token=<value>`.
 *   2. On first load, the page reads `?token` from the URL, stores it in
 *      sessionStorage, and replaces the URL via history.replaceState so the
 *      token is no longer in the visible address bar.
 *   3. Every fetch to `/api/admin/*` includes `X-Tessera-Admin-Token: <token>`.
 *      The server compares to `TESSERA_ADMIN_TOKEN` and 401s on mismatch.
 *   4. If the user reloads the page in the same tab, sessionStorage retains
 *      the token. New tabs require the URL parameter again.
 */

const STORAGE_KEY = 'tessera_admin_token';
const HEADER_NAME = 'X-Tessera-Admin-Token';

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Some browsers block sessionStorage in incognito; non-fatal — the page
    // will simply re-prompt for the token.
  }
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Reads `?token=<value>` from the current URL, stores it, and strips the
 * parameter via history.replaceState. Returns the captured token (or null).
 */
export function captureAdminTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return null;
  setAdminToken(token);
  url.searchParams.delete('token');
  window.history.replaceState({}, '', url.toString());
  return token;
}

/**
 * Wraps `fetch` with the admin token header. Throws if no token is set,
 * which the caller should surface as "open the admin page from the share
 * link first."
 */
export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAdminToken();
  if (!token) {
    throw new Error('No admin token in session — open this page via the admin link.');
  }
  const headers = new Headers(init.headers);
  headers.set(HEADER_NAME, token);
  return fetch(input, { ...init, headers });
}
