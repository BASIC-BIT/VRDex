import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DiscordAdapterRouteProps = {
  params: Promise<{
    path?: string[];
  }>;
};

function adapterError(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status });
}

function requireAdapterRequest(request: NextRequest) {
  const expectedToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const productionBlocked = process.env.VERCEL_ENV === "production" && process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS !== "true";
  const authorization = request.headers.get("authorization") ?? "";

  return (
    !productionBlocked &&
    process.env.VRDEX_ENABLE_E2E_HELPERS === "true" &&
    process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS === "true" &&
    Boolean(expectedToken) &&
    authorization === `Bot ${expectedToken}`
  );
}

export async function GET(request: NextRequest, { params }: DiscordAdapterRouteProps) {
  if (!requireAdapterRequest(request)) {
    return adapterError("E2E Discord adapter is not enabled for this request.");
  }

  const path = (await params).path ?? [];
  const [resource, guildId, nested, subjectId] = path;

  if (resource !== "guilds" || !guildId?.startsWith("e2e-")) {
    return adapterError("Unknown E2E Discord adapter route.", 404);
  }

  if (path.length === 2) {
    return NextResponse.json({ id: guildId, name: `E2E Guild ${guildId}`, owner_id: `owner-${guildId}` });
  }

  if (nested === "members" && subjectId?.startsWith("discord-")) {
    return NextResponse.json({ user: { id: subjectId }, roles: [`admin-${guildId}`] });
  }

  if (nested === "roles") {
    return NextResponse.json([{ id: `admin-${guildId}`, name: "E2E Admin", permissions: "8" }]);
  }

  return adapterError("Unknown E2E Discord adapter route.", 404);
}
