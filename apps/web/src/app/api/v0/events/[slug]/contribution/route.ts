import { handleEventIntakeRequest } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, context: Context) {
  return handleEventIntakeRequest(request, "event_get", await context.params);
}
export async function PATCH(request: Request, context: Context) {
  return handleEventIntakeRequest(request, "event_update", await context.params);
}
export async function DELETE(request: Request, context: Context) {
  return handleEventIntakeRequest(request, "event_retract", await context.params);
}
