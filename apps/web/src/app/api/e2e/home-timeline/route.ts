import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex-generated-api";
import { timelineFixtureBoundary } from "@/lib/timeline/fixture-boundary";
export const dynamic = "force-dynamic";
function boundary(request: NextRequest) {
  const config = timelineFixtureBoundary(
    process.env,
    request.url,
    request.headers.get("x-vrdex-e2e-token"),
  );
  return config
    ? { client: new ConvexHttpClient(config.url), secret: config.secret }
    : null;
}
async function handle(
  request: NextRequest,
  operation: "create" | "cleanup" | "change",
) {
  const gate = boundary(request);
  if (!gate)
    return NextResponse.json({ error: "Unavailable" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("runId" in body) ||
    typeof body.runId !== "string" ||
    !/^playwright-timeline-[a-z0-9-]{8,48}$/.test(body.runId)
  )
    return NextResponse.json({ error: "Invalid run" }, { status: 400 });
  if (operation === "change") {
    if (
      !("eventIndex" in body) ||
      typeof body.eventIndex !== "number" ||
      !Number.isInteger(body.eventIndex) ||
      body.eventIndex < 0 ||
      body.eventIndex > 7 ||
      !("state" in body) ||
      (body.state !== "cancelled" &&
        body.state !== "hidden" &&
        body.state !== "recreate-slot")
    )
      return NextResponse.json(
        { error: "Invalid fixture event" },
        { status: 400 },
      );
    await gate.client.mutation(api.e2eHomeTimeline.changeState, {
      secret: gate.secret,
      runId: body.runId,
      eventIndex: body.eventIndex,
      state: body.state,
    });
    return NextResponse.json({ updated: true });
  }
  if (operation === "cleanup")
    return NextResponse.json(
      await gate.client.mutation(api.e2eHomeTimeline.cleanup, {
        secret: gate.secret,
        runId: body.runId,
      }),
    );
  if (
    !("startAt" in body) ||
    typeof body.startAt !== "number" ||
    !Number.isSafeInteger(body.startAt)
  )
    return NextResponse.json({ error: "Invalid start" }, { status: 400 });
  if (
    "scenario" in body &&
    body.scenario !== "prefetch" &&
    body.scenario !== "detail" &&
    body.scenario !== "discovery"
  )
    return NextResponse.json(
      { error: "Invalid fixture scenario" },
      { status: 400 },
    );
  return NextResponse.json(
    await gate.client.mutation(api.e2eHomeTimeline.create, {
      secret: gate.secret,
      runId: body.runId,
      startAt: body.startAt,
      ...("scenario" in body &&
      (body.scenario === "prefetch" ||
        body.scenario === "detail" ||
        body.scenario === "discovery")
        ? { scenario: body.scenario }
        : {}),
    }),
  );
}
export const POST = (request: NextRequest) => handle(request, "create");
export const DELETE = (request: NextRequest) => handle(request, "cleanup");

export const PATCH = (request: NextRequest) => handle(request, "change");
