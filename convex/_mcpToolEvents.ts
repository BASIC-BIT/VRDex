import { v } from "convex/values";

export const mcpToolNameValidator = v.union(
  v.literal("search"),
  v.literal("fetch"),
  v.literal("vrdex_search"),
  v.literal("vrdex_get_profile"),
  v.literal("vrdex_get_event"),
  v.literal("vrdex_list_upcoming_events"),
  v.literal("vrdex_get_world"),
  v.literal("vrdex_list_active_worlds"),
  v.literal("vrdex_event_create"),
  v.literal("vrdex_event_update"),
  v.literal("vrdex_profile_update"),
  v.literal("vrdex_profile_submit"),
);

export const mcpToolEventRouteClassValidator = v.union(
  v.literal("anonymous_mcp_public_read"),
  v.literal("authenticated_mcp"),
  v.literal("authenticated_mcp_write"),
);

export const mcpToolEventTypeValidator = v.literal("tool_invocation");
export const mcpToolEventResultValidator = v.union(
  v.literal("accepted"),
  v.literal("denied"),
  v.literal("indeterminate"),
  v.literal("readback_warning"),
);

export type McpToolName =
  | "search"
  | "fetch"
  | "vrdex_search"
  | "vrdex_get_profile"
  | "vrdex_get_event"
  | "vrdex_list_upcoming_events"
  | "vrdex_get_world"
  | "vrdex_list_active_worlds"
  | "vrdex_event_create"
  | "vrdex_event_update";

export type McpToolEventRouteClass =
  | "anonymous_mcp_public_read"
  | "authenticated_mcp"
  | "authenticated_mcp_write";

export const mcpToolEventRouteClassValues: McpToolEventRouteClass[] = [
  "anonymous_mcp_public_read",
  "authenticated_mcp",
  "authenticated_mcp_write",
];
