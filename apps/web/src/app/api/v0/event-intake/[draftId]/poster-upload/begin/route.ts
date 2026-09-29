import { handleEventIntakeRequest } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handleEventIntakeRequest(request, "poster_upload_begin", await context.params);
}
