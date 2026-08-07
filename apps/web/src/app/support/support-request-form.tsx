"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * One selector over two backends.
 *
 * The suppression topics keep writing `profileSuppressionRequests`, because
 * accepting one of those retracts profiles from discovery through a scheduled
 * job. Everything else has no automation behind it and lands in
 * `supportRequests`. Sharing a table would put a feedback row one operator
 * click away from opting a profile out.
 *
 * `noteLimit` differs because the two tables do. The suppression note column
 * has always been the shorter one, and one form feeding both has to hold a
 * requester to whichever limit their topic actually has, or the server refuses
 * a message the form said was fine.
 */
const TOPICS = [
  {
    value: "ownership_dispute",
    label: "Someone else claimed a profile that represents me",
    kind: "support",
    noteLimit: 4_000,
  },
  {
    value: "transfer",
    label: "I need to transfer a profile to someone else",
    kind: "support",
    noteLimit: 4_000,
  },
  {
    value: "recovery",
    label: "I lost access to the account that holds my profile",
    kind: "support",
    noteLimit: 4_000,
  },
  {
    value: "owner_opt_out",
    label: "I own this listing and want it opted out",
    kind: "suppression",
    noteLimit: 1_000,
  },
  {
    value: "pre_claim_safety",
    label: "This unclaimed listing needs safety review",
    kind: "suppression",
    noteLimit: 1_000,
  },
  {
    value: "feedback",
    label: "Feedback or something else",
    kind: "support",
    noteLimit: 4_000,
  },
] as const;

type Topic = (typeof TOPICS)[number]["value"];

const TOPIC_VALUES: readonly string[] = TOPICS.map((topic) => topic.value);
const CONTACT_MAX_LENGTH = 160;

// Feedback is the one topic that can be answered by nobody, so it is the one
// that does not ask for a way to answer, or for a profile. Demanding either
// there only suppresses the feedback. Both are enforced server side too.
const TOPICS_ABOUT_A_PROFILE: readonly string[] = TOPICS.filter(
  (topic) => topic.value !== "feedback",
).map((topic) => topic.value);
const TOPICS_REQUIRING_CONTACT: readonly string[] = [
  "ownership_dispute",
  "transfer",
  "recovery",
];

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; repliable: boolean }
  | { kind: "error"; message: string };

/**
 * The refusals worth showing, because each names something the person can fix
 * without leaving the page.
 *
 * Read from the structured payload, not from `error.message`. Convex redacts
 * plain error messages on production deployments, so matching on the text works
 * in development and then silently stops working exactly where it matters:
 * every fixable rejection would have reached a real visitor as the generic
 * backend sentence. `_supportIntake.ts` throws these as `SUPPORT_INPUT_INVALID`
 * for that reason, and `/submit` and the claim flow already do the same.
 *
 * The patterns stay as a fallback for a local backend, where messages are not
 * redacted and the code path is otherwise never exercised.
 */
const userSafeErrorPatterns = [
  /That does not look like a profile\.[^\n]*/,
  /Add a contact so we can reply\./,
  /Tell us which profile this is about, by link or by name\./,
  /Tell us a little more about what you need\./,
  /That (?:message|note) is longer than we can store\.[^\n]*/,
  /That contact is too long\.[^\n]*/,
  /We have more requests than we can answer right now\.[^\n]*/,
  /You already have several requests waiting\.[^\n]*/,
  /Suppression requests need a profile slug or display name\./,
];

function requestErrorMessage(error: unknown): string {
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "SUPPORT_INPUT_INVALID" && data.message) {
    return data.message;
  }

  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  // The shared sentence, not a fourth spelling of it. `error-copy.ts` exists
  // because three forms each had their own wording for "the backend did not
  // answer", so fixing one left the others saying something else. The patterns
  // above are this form's own, which is the part that is meant to differ.
  return BACKEND_ERROR_COPY;
}

function textField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function isTopic(value: string): value is Topic {
  return TOPIC_VALUES.includes(value);
}

/**
 * The unconfigured branch, above the hooks rather than below them.
 *
 * `ConvexClientProvider` deliberately renders its children with no Convex
 * context when `NEXT_PUBLIC_CONVEX_URL` is absent, which is the normal state of
 * a shell-only preview and of a self-hosted instance mid-setup. `useMutation`
 * requires that context, and hooks run before any early return inside the same
 * component, so the notice below could never be reached: the page threw
 * instead of explaining itself.
 */
export function SupportRequestForm() {
  if (!convexUrl) {
    return (
      <Notice className="px-5 py-6 leading-7" variant="dashed">
        Convex is not configured. Run the local backend before submitting requests.
      </Notice>
    );
  }

  return <ConnectedSupportRequestForm />;
}

function ConnectedSupportRequestForm() {
  const searchParams = useSearchParams();
  const requestedTopic = searchParams.get("topic") ?? "";
  const submitSupportRequest = useMutation(api.supportRequests.submitSupportRequest);
  const requestSuppression = useMutation(api.suppressions.requestProfileSuppression);
  // Empty until chosen. A link that names one topic preselects it; a link that
  // names none, like the claim page's, leaves this blank rather than defaulting
  // to a specific request. That footer offers transfer, recovery, and dispute
  // in one sentence, so defaulting to any of the three silently mislabels the
  // other two.
  const [topic, setTopic] = useState<Topic | "">(
    isTopic(requestedTopic) ? requestedTopic : "",
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  // The initializer above runs once. Navigating between `?topic=` links while
  // the form is already mounted -- the footer's two entries do exactly that --
  // changes the query string without remounting, so without this the selector
  // kept its previous topic and could file an ownership dispute for someone who
  // clicked "Privacy request".
  //
  // Unconditional, so a link that carries no topic clears it rather than
  // leaving the last one selected. The footer's "Contact" goes to a bare
  // `/support`, which is precisely the case a guarded version missed.
  useEffect(() => {
    setTopic(isTopic(requestedTopic) ? requestedTopic : "");
  }, [requestedTopic]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const selected = TOPICS.find((entry) => entry.value === topic);

    if (selected === undefined) {
      return;
    }

    const profileSlug = textField(formData.get("profileSlug")) || undefined;
    const profileType = (textField(formData.get("profileType")) || undefined) as
      | "person"
      | "community"
      | undefined;
    const displayName = textField(formData.get("displayName")) || undefined;
    // Trimmed here, because both mutations normalize it away and the success
    // notice is decided from this value. Spaces alone counted as a contact and
    // promised a reply to an address the digest does not contain.
    const requesterContact = textField(formData.get("requesterContact")).trim() || undefined;
    const message = textField(formData.get("message"));

    setStatus({ kind: "submitting" });

    try {
      if (selected.kind === "suppression") {
        await requestSuppression({
          requestType: selected.value as "owner_opt_out" | "pre_claim_safety",
          profileSlug,
          // Load-bearing, not decoration. A name-only request with no type makes
          // the acceptance resolver scan people *and* communities, so accepting
          // one opt-out for "Aurora" could retract every namesake of both kinds.
          profileType,
          displayName,
          requesterContact,
          requesterNote: message,
        });
      } else {
        await submitSupportRequest({
          topic: selected.value as "ownership_dispute" | "transfer" | "recovery" | "feedback",
          profileSlug,
          profileType,
          displayName,
          requesterContact,
          message,
        });
      }

      form.reset();
      setTopic("");
      startTransition(() =>
        setStatus({ kind: "success", repliable: Boolean(requesterContact) }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: requestErrorMessage(error) }));
    }
  }

  const selectedTopic = TOPICS.find((entry) => entry.value === topic);
  const contactRequired = TOPICS_REQUIRING_CONTACT.includes(topic);
  // Shown before a topic is picked, because five of the six want it and an
  // empty-looking page is a worse first impression than one field that turns
  // out not to apply. Only feedback takes it away.
  const aboutAProfile = topic === "" || TOPICS_ABOUT_A_PROFILE.includes(topic);

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field>
        Request type
        <Select
          name="topic"
          onChange={(event) => setTopic(event.currentTarget.value as Topic | "")}
          required
          value={topic}
        >
          <option disabled value="">
            Choose one
          </option>
          {TOPICS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      {aboutAProfile ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Profile
              <Input name="profileSlug" placeholder="Paste the profile link" />
            </Field>

            <Field>
              Name, if you do not have the link
              <Input name="displayName" placeholder="DJ Aurora" />
            </Field>
          </div>

          <Field className="sm:max-w-xs">
            Is this a person or a community?
            <Select defaultValue="person" name="profileType">
              <option value="person">Person</option>
              <option value="community">Community</option>
            </Select>
          </Field>
        </>
      ) : null}

      <Field>
        {contactRequired ? "Contact for follow-up" : "Contact for follow-up, if you want a reply"}
        <Input
          maxLength={CONTACT_MAX_LENGTH}
          name="requesterContact"
          placeholder="Email or Discord handle"
          required={contactRequired}
        />
      </Field>

      <Field>
        Message
        <Textarea
          className="min-h-40"
          maxLength={selectedTopic?.noteLimit ?? 4_000}
          name="message"
          placeholder="Tell us what happened. Paste links to anything that backs it up."
          required
        />
        <FieldText>
          Links are enough. Do not paste passwords, codes, or anything else private.
        </FieldText>
      </Field>

      <Button
        className="w-fit"
        disabled={status.kind === "submitting" || topic === ""}
        size="lg"
        type="submit"
        variant="primary"
      >
        {status.kind === "submitting" ? "Sending..." : "Send request"}
      </Button>

      {status.kind === "success" ? (
        <Notice variant="success">
          {status.repliable
            ? "Request sent. We reply to the contact you gave."
            : "Request sent. You did not leave a contact, so we cannot reply to this one."}
        </Notice>
      ) : null}
      {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
    </form>
  );
}
