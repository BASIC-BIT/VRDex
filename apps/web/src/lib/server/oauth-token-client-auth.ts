import {
  hashOAuthClientSecretValue,
  normalizeOAuthClientId,
  parseOAuthClientSecretValue,
} from "@vrdex/api-contracts";

function oauthProblem(
  status: 400 | 401 | 500,
  error: string,
  errorDescription: string,
  headers: HeadersInit = {},
) {
  return Response.json(
    {
      error,
      error_description: errorDescription,
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
        ...headers,
      },
      status,
    },
  );
}

export function clientSecretPepper() {
  const pepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret validation.");
  }

  return pepper;
}

export function basicClientCredentials(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Basic[\t ]+(.+)$/i);

  if (match === undefined || match === null) {
    return {};
  }

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return {};
    }

    return {
      clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
      clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1)),
    };
  } catch {
    return {};
  }
}

export async function tokenClientAuthentication(
  request: Request,
  form: FormData,
): Promise<
  | {
      ok: true;
      clientId: string;
      secretPrefix?: string;
      verifierHash?: string;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  const basicCredentials = basicClientCredentials(request);
  const formClientId = String(form.get("client_id") ?? "").trim();
  const formClientSecret = String(form.get("client_secret") ?? "").trim();

  if (basicCredentials.clientId !== undefined && formClientId && basicCredentials.clientId !== formClientId) {
    return {
      ok: false,
      response: oauthProblem(401, "invalid_client", "Client authentication failed.", {
        "www-authenticate": 'Basic realm="VRDex OAuth"',
      }),
    };
  }

  if (basicCredentials.clientSecret !== undefined && formClientSecret) {
    return {
      ok: false,
      response: oauthProblem(400, "invalid_request", "Use only one OAuth client authentication method."),
    };
  }

  const clientIdValue = basicCredentials.clientId ?? formClientId;
  if (!clientIdValue) {
    return {
      ok: false,
      response: oauthProblem(400, "invalid_request", "client_id is required."),
    };
  }

  let clientId: string;

  try {
    clientId = normalizeOAuthClientId(clientIdValue);
  } catch {
    return {
      ok: false,
      response: oauthProblem(401, "invalid_client", "Client authentication failed.", {
        "www-authenticate": 'Basic realm="VRDex OAuth"',
      }),
    };
  }

  const clientSecret = basicCredentials.clientSecret ?? formClientSecret;
  if (!clientSecret) {
    return { ok: true, clientId };
  }

  const parsedSecret = parseOAuthClientSecretValue(clientSecret);
  if (parsedSecret === null) {
    return {
      ok: false,
      response: oauthProblem(401, "invalid_client", "Client authentication failed.", {
        "www-authenticate": 'Basic realm="VRDex OAuth"',
      }),
    };
  }

  try {
    return {
      ok: true,
      clientId,
      secretPrefix: parsedSecret.secretPrefix,
      verifierHash: await hashOAuthClientSecretValue(clientSecret, clientSecretPepper()),
    };
  } catch {
    return {
      ok: false,
      response: oauthProblem(
        500,
        "server_error",
        "The server is not configured to validate OAuth client secrets.",
      ),
    };
  }
}
