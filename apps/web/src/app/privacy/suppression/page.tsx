import { redirect } from "next/navigation";

/**
 * Folded into `/support`.
 *
 * This form was never linked from anywhere in the app, so the only way to reach
 * it was to already know the URL. It asked for almost exactly the fields a
 * dispute or a transfer needs, and splitting near-identical intake across two
 * pages is what the one front door replaces.
 *
 * The route stays rather than being deleted: it is the address in the production
 * smoke suite, and anyone who bookmarked it or was sent it by an operator lands
 * on the same request with its topic already chosen.
 */
export default function SuppressionRequestPage() {
  redirect("/support?topic=owner_opt_out");
}
