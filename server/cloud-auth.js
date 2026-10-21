import { RaceError } from "./races.js";

// The race membership token stays in Authorization. Verify the separate
// Supabase access token with the project's auth server, never by decoding it.
export function createCloudAuth({
  url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  fetchUser = fetch,
} = {}) {
  return async (token) => {
    if (!url || !key)
      throw new RaceError(
        "Configure Supabase on the friends server, then restart it.",
        503,
      );
    let response;
    try {
      response = await fetchUser(`${url.replace(/\/$/, "")}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new RaceError(
        "Cannot verify your account. Try again shortly.",
        503,
      );
    }
    if (!response.ok) {
      const error = new RaceError(
        "Your login has expired.",
        response.status >= 500 ? 503 : 401,
      );
      error.authRequired = error.status === 401;
      throw error;
    }
    const user = await response.json();
    if (!user.id || !user.email) throw new RaceError("Invalid account.", 401);
    return {
      id: `supabase:${user.id}`,
      username: user.email.split("@")[0].slice(0, 24),
    };
  };
}
