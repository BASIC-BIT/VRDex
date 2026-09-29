import { handleEventIntakeRequest } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handleEventIntakeRequest(request, "draft_get", await context.params);
}
export async function PATCH(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handleEventIntakeRequest(request, "draft_save", await context.params);
}
