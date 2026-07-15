import { dynamicMcpClientRegistrationResponse } from "@/lib/server/oauth-dynamic-client-registration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return await dynamicMcpClientRegistrationResponse(request);
}
