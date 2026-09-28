import { z, eventIntakeOperations, type EventIntakeOperation } from "@vrdex/api-contracts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAuthToken, viewerQuery } from "./auth";
import { convexHttpClient } from "./convex-http";
import { createEventIntakeCommands, eventIntakeErrorResponse } from "./event-intake-api";
import { createEventPosterHandlers } from "./event-poster-storage";

const envelope = z.strictObject({ operation: z.enum(["extract", "poster_upload_begin", "poster_upload_complete", "artwork_select", "poster_read"]), input: z.unknown() });
const source = z.strictObject({ posterAssetId: z.string().min(1).max(200) });
const headers = { "cache-control": "private, no-store" };
const problem = (status: number) => Response.json({ status }, { status, headers });
async function sessionActor() {
  const token = await convexAuthToken();
  if (!token) return null;
  const client = convexHttpClient();
  client.setAuth(token);
  return (await client.query(viewerQuery, {}))?.user.id ?? null;
}
export function createWebsiteEventIntakeHandler(deps: {
  actor?: typeof sessionActor;
  commands?: (actorUserId: Id<"users">) => (operation: EventIntakeOperation, input: unknown) => Promise<unknown>;
  readPoster?: (actorUserId: Id<"users">, posterAssetId: Id<"eventPosterSources">) => Promise<string>;
} = {}) {
  return async (request: Request) => {
    try {
      if (request.headers.get("origin") !== new URL(request.url).origin) return problem(403);
      const actor = await (deps.actor ?? sessionActor)();
      if (!actor) return problem(401);
      // Bound bytes while streaming, including requests without Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return problem(400);
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 64_000) { await reader.cancel(); return problem(413); }
        chunks.push(value);
      }
      let command: z.infer<typeof envelope>;
      let input: unknown;
      try {
        command = envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        input = command.operation === "poster_read" ? source.parse(command.input) : eventIntakeOperations[command.operation].input.parse(command.input);
      } catch { return problem(400); }
      if (command.operation === "poster_read") {
        const { posterAssetId } = source.parse(input);
        const dataUrl = await (deps.readPoster ?? ((id, poster) => createEventPosterHandlers({ authority: async () => ({ actorUserId: id }) }).readPoster(poster)))(actor, posterAssetId as Id<"eventPosterSources">);
        return Response.json({ dataUrl }, { headers });
      }
      const commands = deps.commands?.(actor) ?? createEventIntakeCommands({ actorUserId: actor });
      return Response.json(await commands(command.operation, input), { headers });
    } catch (error) { return eventIntakeErrorResponse(error); }
  };
}
