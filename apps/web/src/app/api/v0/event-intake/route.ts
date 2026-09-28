import { handleEventIntakeRequest } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleEventIntakeRequest(request, "draft_save");
}
