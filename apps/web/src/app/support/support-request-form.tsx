"use client";

import { FormEvent, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * One selector over two backends.
 *
 * The suppression topics keep writing `profileSuppressionRequests`, because
 * accepting one of those retracts profiles from discovery through a scheduled
 * job. Everything else has no automation behind it and lands in
 * `supportRequests`. Sharing a table would put a feedback row one operator
 * click away from opting a profile out.
 */
const TOPICS = [
  {
    value: "ownership_dispute",
    label: "Someone else claimed a profile that represents me",
    kind: "support",
  },
  { value: "transfer", label: "I need to transfer a profile to someone else", kind: "support" },
  {
    value: "recovery",
    label: "I lost access to the account that holds my profile",
    kind: "support",
  },
  {
    value: "owner_opt_out",
    label: "I own this listing and want it opted out",
    kind: "suppression",
  },
  {
    value: "pre_claim_safety",
    label: "This unclaimed listing needs safety review",
    kind: "suppression",
  },
  { value: "feedback", label: "Feedback or something else", kind: "support" },
] as const;

type Topic = (typeof TOPICS)[number]["value"];

const TOPIC_VALUES: readonly string[] = TOPICS.map((topic) => topic.value);
const DEFAULT_TOPIC: Topic = "ownership_dispute";

// Feedback is the one topic that can be answered by nobody, so it is the one
// that does not ask for a way to answer. Demanding an address there only
// suppresses the feedback. Enforced server side too.
const TOPICS_REQUIRING_CONTACT: readonly string[] = [
  "ownership_dispute",
  "transfer",
  "recovery",
];

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

/**
 * The refusals that are worth showing, because each names something the person
 * can fix without leaving the page.
 *
 * Everything else becomes the generic line. A Convex error carries the function
 * name, a request id, and a source location, and rendering `error.message`
 * straight into the page put that whole stack dump in front of whoever mistyped
 * a link.
 */
const RECOVERABLE_ERROR_PATTERNS = [
  /That does not look like a profile\.[^\n]*/,
  /Add a contact so we can reply\./,
  /Tell us a little more about what you need\./,
  /Suppression requests need a profile slug or display name\./,
];

function requestErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of RECOVERABLE_ERROR_PATTERNS) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "That did not send. Try again in a moment.";
}

function textField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function isTopic(value: string): value is Topic {
  return TOPIC_VALUES.includes(value);
}

export function SupportRequestForm() {
  const searchParams = useSearchParams();
  const requestedTopic = searchParams.get("topic") ?? "";
  const submitSupportRequest = useMutation(api.supportRequests.submitSupportRequest);
  const requestSuppression = useMutation(api.suppressions.requestProfileSuppression);
  const [topic, setTopic] = useState<Topic>(
    isTopic(requestedTopic) ? requestedTopic : DEFAULT_TOPIC,
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  if (!convexUrl) {
    return (
      <Notice className="px-5 py-6 leading-7" variant="dashed">
        Convex is not configured. Run the local backend before submitting requests.
      </Notice>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const selected = TOPICS.find((entry) => entry.value === topic) ?? TOPICS[0];
    const profileSlug = textField(formData.get("profileSlug")) || undefined;
    const displayName = textField(formData.get("displayName")) || undefined;
    const requesterContact = textField(formData.get("requesterContact")) || undefined;
    const message = textField(formData.get("message"));

    setStatus({ kind: "submitting" });

    try {
      if (selected.kind === "suppression") {
        await requestSuppression({
          requestType: selected.value as "owner_opt_out" | "pre_claim_safety",
          profileSlug,
          displayName,
          requesterContact,
          requesterNote: message,
        });
      } else {
        await submitSupportRequest({
          topic: selected.value as "ownership_dispute" | "transfer" | "recovery" | "feedback",
          profileSlug,
          displayName,
          requesterContact,
          message,
        });
      }

      form.reset();
      setTopic(DEFAULT_TOPIC);
      startTransition(() => setStatus({ kind: "success" }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: requestErrorMessage(error) }));
    }
  }

  const contactRequired = TOPICS_REQUIRING_CONTACT.includes(topic);

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field>
        Request type
        <Select
          name="topic"
          onChange={(event) => setTopic(event.currentTarget.value as Topic)}
          value={topic}
        >
          {TOPICS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

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

      <Field>
        {contactRequired ? "Contact for follow-up" : "Contact for follow-up, if you want a reply"}
        <Input
          name="requesterContact"
          placeholder="Email or Discord handle"
          required={contactRequired}
        />
      </Field>

      <Field>
        Message
        <Textarea
          className="min-h-40"
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
        disabled={status.kind === "submitting"}
        size="lg"
        type="submit"
        variant="primary"
      >
        {status.kind === "submitting" ? "Sending..." : "Send request"}
      </Button>

      {status.kind === "success" ? (
        <Notice variant="success">Request sent. We reply to the contact you gave.</Notice>
      ) : null}
      {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
    </form>
  );
}
