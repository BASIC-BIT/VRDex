import { invalidAuthSessionRedirectResponse } from "@/lib/server/invalid-auth-session";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return invalidAuthSessionRedirectResponse(request);
}
