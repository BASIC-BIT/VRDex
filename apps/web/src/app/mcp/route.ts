import {
  createVrdexMcpHandler,
  rejectInvalidOrRateLimitedMcpRequest,
  withMcpHttpHeaders,
} from "@/lib/server/vrdex-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createVrdexMcpHandler();

async function handleMcpRequest(request: Request) {
  const rejected = await rejectInvalidOrRateLimitedMcpRequest(request);

  if (rejected !== null) {
    return rejected;
  }

  return withMcpHttpHeaders(await handler.fetch(request));
}

export function OPTIONS() {
  return withMcpHttpHeaders(new Response(null, { status: 204 }));
}

export const DELETE = handleMcpRequest;
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
