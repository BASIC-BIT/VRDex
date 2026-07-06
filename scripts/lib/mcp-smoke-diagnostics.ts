const maxDiagnosticLength = 700;

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
