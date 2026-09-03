const maxDiagnosticLength = 700;

function isSameIssuerAuthorizationUrl(value: string, issuer: URL, allowRelative: boolean) {
  try {
    const target = allowRelative ? new URL(value, issuer) : new URL(value);
    return (allowRelative || target.protocol === "https:")
      && target.origin === issuer.origin
      && target.pathname === "/oauth/authorize";
  } catch {
    return false;
  }
}

export function isExpectedOAuthAuthorizationRedirect(location: string, issuerValue: string) {
  try {
    const issuer = new URL(issuerValue);
    const redirect = new URL(location, issuer);

    if (redirect.origin === issuer.origin && redirect.pathname === "/sign-in") {
      const returnTargets = [
        ...redirect.searchParams.getAll("returnTo"),
        ...redirect.searchParams.getAll("next"),
      ];
      return returnTargets.length === 1
        && isSameIssuerAuthorizationUrl(returnTargets[0]!, issuer, true);
    }

    if (
      redirect.protocol !== "https:"
      || !/^[a-z0-9-]+\.clerk\.accounts\.dev$/i.test(redirect.hostname)
      || redirect.pathname !== "/v1/client/handshake"
    ) {
      return false;
    }

    const returnTargets = redirect.searchParams.getAll("redirect_url");
    return returnTargets.length === 1
      && isSameIssuerAuthorizationUrl(returnTargets[0]!, issuer, false);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/("authorization"\s*:\s*")([^"]+)(")/gi, "$1<redacted>$3")
    .replace(/("access_token"\s*:\s*")([^"]+)(")/gi, "$1<redacted>$3")
    .replace(/("refresh_token"\s*:\s*")([^"]+)(")/gi, "$1<redacted>$3")
    .replace(/("client_secret"\s*:\s*")([^"]+)(")/gi, "$1<redacted>$3");
}

function truncateDiagnostic(value: string) {
  const sanitized = sanitizeDiagnostic(value.trim());

  if (sanitized.length <= maxDiagnosticLength) {
    return sanitized;
  }

  return `${sanitized.slice(0, maxDiagnosticLength - 3)}...`;
}

function compactJson(value: unknown) {
  try {
    return truncateDiagnostic(JSON.stringify(value));
  } catch {
    return "<unserializable>";
  }
}

function textFromContent(content: unknown) {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((entry) => {
      if (isRecord(entry) && typeof entry.text === "string") {
        return entry.text;
      }

      return undefined;
    })
    .filter((value): value is string => value !== undefined)
    .join("\n")
    .trim();

  return text || "<empty text content>";
}

export function summarizeMcpToolFailure(response: unknown) {
  if (!isRecord(response)) {
    return compactJson(response);
  }

  const details: string[] = [];

  if (response.error !== undefined) {
    details.push(`jsonRpcError=${compactJson(response.error)}`);
  }

  const result = response.result;

  if (isRecord(result)) {
    if (result.isError !== undefined) {
      details.push(`isError=${compactJson(result.isError)}`);
    }

    const contentText = textFromContent(result.content);

    if (contentText !== undefined) {
      details.push(`content=${truncateDiagnostic(contentText)}`);
    }

    if (result.structuredContent !== undefined) {
      details.push(`structuredContent=${compactJson(result.structuredContent)}`);
    }
  }

  if (details.length === 0) {
    details.push(`response=${compactJson(response)}`);
  } else if (details.length === 1 && details[0] === "isError=true") {
    details.push(`response=${compactJson(response)}`);
  }

  return details.join("; ");
}
