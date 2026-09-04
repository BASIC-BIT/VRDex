/**
 * VRChat session cookie handling shared by the operator login bootstrap and
 * the collector's provider client: the provider may rotate or clear `auth`
 * and `twoFactorAuth` on any authenticated response, and whoever holds the
 * live session has to follow it.
 */

export function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

/** Whether a `Set-Cookie` header is the provider clearing that cookie. */
function isCookieDeletion(header, value) {
  if (value === "") {
    return true;
  }

  const attributes = header.split(";").slice(1);

  for (const attribute of attributes) {
    const [rawName, rawValue = ""] = attribute.split("=");
    const name = rawName.trim().toLowerCase();

    if (name === "max-age" && Number(rawValue.trim()) <= 0) {
      return true;
    }

    if (name === "expires") {
      const expires = Date.parse(rawValue.trim());

      if (Number.isFinite(expires) && expires <= Date.now()) {
        return true;
      }
    }
  }

  return false;
}

/** Apply `Set-Cookie` headers to a `Map` of session cookies by name. */
export function applySessionCookies(target, headers) {
  for (const header of headers) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name !== "auth" && name !== "twoFactorAuth") continue;

    // A cleared cookie is an instruction, not a no-op. Ignoring the deletion
    // left the previous value in the map, so the session reported as refreshed
    // still carried a two-factor cookie the provider had just retired — and the
    // transfer wrote it into Secrets Manager for every collector restart.
    if (isCookieDeletion(header, value)) {
      target.delete(name);
      continue;
    }

    target.set(name, value);
  }
}
