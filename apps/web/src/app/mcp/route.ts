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

  const invocationRequest = request.clone();

  const response = await handler.fetch(request, {
    ...(!("authInfo" in authorization) || authorization.authInfo === undefined
      ? {}
      : { authInfo: authorization.authInfo }),
  });

  await recordAcceptedMcpToolInvocations(invocationRequest, response);

  return withMcpHttpHeaders(response);
}

export function OPTIONS() {
  return withMcpHttpHeaders(new Response(null, { status: 204 }));
}

export const DELETE = handleMcpRequest;
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
