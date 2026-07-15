import type { Doc } from "./_generated/dataModel";

type CountValue = string | undefined;
type CountFields = Record<string, CountValue>;
type CountEntry<T extends CountFields> = T & { count: number };

type ApiTokenEvent = Pick<
  Doc<"apiTokenEvents">,
  "eventType" | "result" | "routeClass" | "statusCodeClass"
>;
type ApiRateLimitEvent = Pick<
  Doc<"apiRateLimitEvents">,
  "identityKind" | "quotaTier" | "routeClass"
>;
type ApiWriteAuditEvent = Pick<
  Doc<"apiWriteAuditEvents">,
  "action" | "actorKind" | "resourceType" | "result" | "routeClass"
>;
type OAuthClientEvent = Pick<
  Doc<"oauthClientEvents">,
  "eventType" | "result" | "routeClass" | "validationResult"
>;
type McpToolEvent = Pick<Doc<"mcpToolEvents">, "routeClass" | "toolName">;

function countKey(fields: CountFields) {
  return Object.entries(fields)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("|");
}

function increment<T extends CountFields>(counts: Map<string, CountEntry<T>>, fields: T) {
  const key = countKey(fields);
  const existing = counts.get(key);

  if (existing === undefined) {
    counts.set(key, { ...fields, count: 1 });
    return;
  }

  existing.count += 1;
}

function sortedCounts<T extends CountFields>(counts: Map<string, CountEntry<T>>) {
  const countEntryKey = (entry: CountEntry<T>) =>
    countKey(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "count")) as CountFields);

  return [...counts.values()].sort((first, second) => {
    const firstKey = countEntryKey(first);
    const secondKey = countEntryKey(second);

    return firstKey.localeCompare(secondKey);
  });
}

function oauthGrantForEvent(event: OAuthClientEvent) {
  if (event.eventType === "authorization_code_redeemed") {
    return "authorization_code";
  }

  if (event.eventType === "refresh_token_rotated") {
    return "refresh_token";
  }

  if (event.eventType === "token_issued" || event.eventType === "client_credentials_rejected") {
    return "client_credentials";
  }

  return null;
}

export function summarizeApiPlatformEventRows(input: {
  apiRateLimitEvents: ApiRateLimitEvent[];
  apiTokenEvents: ApiTokenEvent[];
  apiWriteAuditEvents: ApiWriteAuditEvent[];
  mcpToolEvents: McpToolEvent[];
  oauthClientEvents: OAuthClientEvent[];
}) {
  const apiRateLimitBlocks = new Map<
    string,
    CountEntry<{ identityKind: string; quotaTier: string; routeClass: string }>
  >();
  const apiTokenEvents = new Map<
    string,
    CountEntry<{ eventType: string; result: string; routeClass: string; statusCodeClass?: string }>
  >();
  const apiTokenValidationEvents = new Map<
    string,
    CountEntry<{ result: string; routeClass: string; statusCodeClass?: string }>
  >();
  const apiWriteAuditEvents = new Map<
    string,
    CountEntry<{ action: string; actorKind: string; resourceType: string; result: string; routeClass: string }>
  >();
  const mcpToolInvocations = new Map<string, CountEntry<{ routeClass: string; toolName: string }>>();
  const oauthClientEvents = new Map<
    string,
    CountEntry<{ eventType: string; result: string; routeClass: string; validationResult?: string }>
  >();
  const oauthGrantEvents = new Map<
    string,
    CountEntry<{ grantType: string; result: string; routeClass: string }>
  >();
  const oauthAccessTokenValidationEvents = new Map<
    string,
    CountEntry<{ result: string; routeClass: string }>
  >();

  for (const event of input.apiRateLimitEvents) {
    increment(apiRateLimitBlocks, {
      identityKind: event.identityKind,
      quotaTier: event.quotaTier,
      routeClass: event.routeClass,
    });
  }

  for (const event of input.apiTokenEvents) {
    increment(apiTokenEvents, {
      eventType: event.eventType,
      result: event.result,
      routeClass: event.routeClass,
      ...(event.statusCodeClass === undefined ? {} : { statusCodeClass: event.statusCodeClass }),
    });

    if (event.eventType === "validation_accepted" || event.eventType === "validation_rejected") {
      increment(apiTokenValidationEvents, {
        result: event.result,
        routeClass: event.routeClass,
        ...(event.statusCodeClass === undefined ? {} : { statusCodeClass: event.statusCodeClass }),
      });
    }
  }

  for (const event of input.apiWriteAuditEvents) {
    increment(apiWriteAuditEvents, {
      action: event.action,
      actorKind: event.actorKind,
      resourceType: event.resourceType,
      result: event.result,
      routeClass: event.routeClass,
    });
  }

  for (const event of input.mcpToolEvents) {
    increment(mcpToolInvocations, {
      routeClass: event.routeClass,
      toolName: event.toolName,
    });
  }

  for (const event of input.oauthClientEvents) {
    increment(oauthClientEvents, {
      eventType: event.eventType,
      result: event.result,
      routeClass: event.routeClass,
      ...(event.validationResult === undefined ? {} : { validationResult: event.validationResult }),
    });

    const grantType = oauthGrantForEvent(event);
    if (grantType !== null) {
      increment(oauthGrantEvents, {
        grantType,
        result: event.result,
        routeClass: event.routeClass,
      });
    }

    if (event.eventType === "validation_accepted" || event.eventType === "validation_rejected") {
      increment(oauthAccessTokenValidationEvents, {
        result: event.validationResult ?? event.result,
        routeClass: event.routeClass,
      });
    }
  }

  return {
    apiRateLimitBlocks: sortedCounts(apiRateLimitBlocks),
    apiTokenEvents: sortedCounts(apiTokenEvents),
    apiTokenValidationEvents: sortedCounts(apiTokenValidationEvents),
    apiWriteAuditEvents: sortedCounts(apiWriteAuditEvents),
    mcpToolInvocations: sortedCounts(mcpToolInvocations),
    oauthAccessTokenValidationEvents: sortedCounts(oauthAccessTokenValidationEvents),
    oauthClientEvents: sortedCounts(oauthClientEvents),
    oauthGrantEvents: sortedCounts(oauthGrantEvents),
  };
}
