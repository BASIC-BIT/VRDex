import {
  authorizeHostedMcpRequest,
  createVrdexMcpHandler,
  recordAcceptedMcpToolInvocations,
  withMcpHttpHeaders,
} from "@/lib/server/vrdex-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createVrdexMcpHandler();

async function handleMcpRequest(request: Request) {
  const authorization = await authorizeHostedMcpRequest(request);

  if (authorization.response !== null) {
    return authorization.response;
  }

  await recordAcceptedMcpToolInvocations(request.clone());

  return withMcpHttpHeaders(await handler.fetch(request, {
    ...(!("authInfo" in authorization) || authorization.authInfo === undefined
      ? {}
      : { authInfo: authorization.authInfo }),
  }));
}

export function OPTIONS() {
  return withMcpHttpHeaders(new Response(null, { status: 204 }));
}

export const DELETE = handleMcpRequest;
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
