import { redirect } from "next/navigation";

export default function NewEventPage() {
  redirect("/account/events");
}
