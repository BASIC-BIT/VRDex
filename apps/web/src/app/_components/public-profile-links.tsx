"use client";

import type { CSSProperties } from "react";

import { LookupCopyButton } from "./lookup-copy-button";
import { ProfileDestinationArtwork } from "./profile-destination-artwork";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { discordCopyValue } from "@/lib/discord-link";
import type { PublicSearchPerson } from "@/lib/public-search";
import { profileLinkPresentation } from "../../../../../convex/_profileLinkPresentation";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

type PublicProfileLink = PublicSearchPerson["outboundLinks"][number];

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isVrcdnPreviewLink(link: PublicProfileLink) {
  return link.type === "vrcdn" && (link.label.toLowerCase().includes("preview") || link.url.includes("panel.vrcdn.live"));
}

function isVrcdnStreamLink(link: PublicProfileLink) {
  return link.type === "vrcdn" && !isVrcdnPreviewLink(link);
}

/**
 * Both derived through the shared stream parser rather than by pulling the URL
 * apart here.
 *
 * These used to read the last path segment and rebuild `rtspt://` from the
 * hostname, which happens to work for one spelling and fails for the rest. The
 * stored form is now `vrcdn:<streamId>`, which has no hostname at all -- that
 * produced `rtspt:///live/<id>` and offered the identifier itself as the Quest
 * value, so everything copied off this page was unusable.
 */
function deriveVrcdnPreviewLink(url: string): { label: string; url: string } | null {
  const stream = parseVrcdnStreamLinks(url);

  return stream ? { label: "VRCDN preview", url: stream.previewUrl } : null;
}

function deriveVrcdnCopyLinks(url: string): Array<{ label: string; value: string }> {
  const stream = parseVrcdnStreamLinks(url);

  if (stream === null) {
    return [{ label: "VRCDN stream", value: url }];
  }

  return [
    { label: "Quest MPEG-TS", value: stream.questUrl },
    { label: "PC RTSPT", value: stream.pcUrl },
  ];
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
      <path d="M7.25 4.25h8.5v8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="m15.25 4.75-10.5 10.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function BrandIcon({ type }: { type: "discord" | "twitch" | "vrchat_profile" }) {
  if (type === "discord") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      </svg>
    );
  }

  if (type === "twitch") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22.732 6.767H1.268A1.27 1.27 0 0 0 0 8.035v5.296c0 .7.57 1.268 1.268 1.268h18.594l1.725 2.22c.215.275.443.415.68.415.153 0 .296-.06.403-.167.128-.129.193-.308.193-.536l-.002-1.939A1.27 1.27 0 0 0 24 13.331V8.035c0-.7-.569-1.269-1.268-1.269Zm.8 6.564a.8.8 0 0 1-.8.801h-.34v.031l.004 2.371c0 .155-.05.233-.129.233s-.19-.079-.31-.235l-1.866-2.4H1.268a.8.8 0 0 1-.8-.8V8.064a.8.8 0 0 1 .8-.8h21.464a.8.8 0 0 1 .8.8v5.266ZM4.444 8.573c-.127 0-.225.041-.254.15l-.877 3.129-.883-3.128c-.03-.11-.127-.15-.254-.15-.202 0-.473.126-.473.311 0 .012.005.035.011.058l1.114 3.63c.058.173.265.254.485.254s.433-.08.484-.254l1.109-3.63c.005-.023.011-.04.011-.058 0-.179-.27-.312-.473-.312Zm2.925 2.36c.433-.132.757-.49.757-1.153 0-.918-.612-1.207-1.368-1.207H5.614a.234.234 0 0 0-.242.231v3.752c0 .156.184.237.374.237s.376-.081.376-.237V11.05h.484l.82 1.593c.058.115.156.179.26.179.219 0 .467-.203.467-.393a.155.155 0 0 0-.028-.092l-.756-1.403Zm-.61-.473h-.636V9.231h.635c.375 0 .618.162.618.618s-.242.612-.618.612Zm10.056.826h1.004l-.502-1.772-.502 1.772Zm4.684-3.095H9.366a.8.8 0 0 0-.8.8v3.383a.8.8 0 0 0 .8.8h12.132a.8.8 0 0 0 .8-.8V8.992a.8.8 0 0 0-.8-.801Zm-10.946 3.977c.525 0 .571-.374.589-.617.011-.179.173-.236.369-.236.26 0 .38.075.38.369 0 .698-.57 1.142-1.379 1.142-.727 0-1.327-.357-1.327-1.322v-1.61c0-.963.606-1.322 1.333-1.322.802 0 1.374.427 1.374 1.097 0 .3-.121.37-.375.37-.214 0-.37-.064-.375-.238-.012-.178-.052-.57-.6-.57-.387 0-.606.213-.606.663v1.61c0 .45.219.664.617.664Zm4.703.388c0 .156-.19.237-.375.237s-.375-.081-.375-.237V10.9h-1.299v1.656c0 .156-.19.237-.375.237s-.375-.081-.375-.237V8.804c0-.161.185-.23.375-.23s.375.069.375.23v1.507h1.299V8.804c0-.161.185-.23.375-.23s.375.069.375.23v3.752Zm3.198.236c-.127 0-.225-.04-.254-.15l-.22-.768h-1.322l-.219.768c-.029.11-.127.15-.254.15-.202 0-.473-.127-.473-.311 0-.012.006-.035.012-.058l1.114-3.63c.051-.173.265-.254.478-.254s.433.08.485.254l1.114 3.63c.006.023.012.04.012.058 0 .179-.272.311-.473.311Zm2.989-3.543h-.843v3.306c0 .156-.19.237-.375.237s-.375-.081-.375-.237V9.25h-.848c-.15 0-.237-.157-.237-.34 0-.162.075-.336.237-.336h2.44c.162 0 .238.173.238.335 0 .18-.087.34-.237.34Z" />
    </svg>
  );
}

function LinkTypeIcon({ type }: { type: PublicProfileLink["type"] }) {
  if (type === "discord" || type === "twitch" || type === "vrchat_profile") {
    return <BrandIcon type={type} />;
  }

  if (type === "soundcloud") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9.2 17.5h9.1a3.7 3.7 0 0 0 0-7.4 4.9 4.9 0 0 0-9.6-1.2v8.6h.5Zm-2.4 0h1V9.4a5.4 5.4 0 0 0-1-.2v8.3Zm-2 0h1v-7.7a4.8 4.8 0 0 0-1 .9v6.8Zm-2 0h1v-5.4a4.8 4.8 0 0 0-1 .2v5.2Zm-2 0h1v-4.8a3.6 3.6 0 0 0-1 2.4v2.4Z" />
      </svg>
    );
  }

  if (type === "spotify") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <path d="M6.2 8.9c4.15-1.15 8.35-.7 11.9 1.3" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        <path d="M7 12.1c3.18-.82 6.35-.45 9.05 1.08" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
        <path d="M7.65 15.05c2.48-.58 4.78-.32 6.82.78" stroke="currentColor" strokeLinecap="round" strokeWidth="1.65" />
      </svg>
    );
  }

  if (type === "youtube") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 1.9A29.2 29.2 0 0 0 2 12a29.2 29.2 0 0 0 .5 4.8 2.8 2.8 0 0 0 1.9 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-1.9A29.2 29.2 0 0 0 22 12a29.2 29.2 0 0 0-.4-4.8ZM10 15.1V8.9l5.2 3.1-5.2 3.1Z" />
      </svg>
    );
  }

  if (type === "bandcamp") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7.1 6.5h14.1l-4.3 11H2.8l4.3-11Z" />
      </svg>
    );
  }

  if (type === "instagram") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <rect width="15" height="15" x="4.5" y="4.5" stroke="currentColor" strokeWidth="2" rx="4" />
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
        <circle cx="16.8" cy="7.3" r="1" fill="currentColor" />
      </svg>
    );
  }

  if (type === "mixcloud") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8.4 17.5h9.1a3.5 3.5 0 0 0 .4-7A5.7 5.7 0 0 0 7 8.6 4.5 4.5 0 0 0 8.4 17.5Zm0-2a2.5 2.5 0 1 1 .4-5l.8.1.3-.8a3.7 3.7 0 0 1 7.2 1.2v1.3h.6a1.6 1.6 0 0 1-.2 3.2H8.4Z" />
      </svg>
    );
  }

  if (type === "commissions") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <path d="M6 8h12v11H6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
        <path d="M9 8V6.8A2.8 2.8 0 0 1 11.8 4h.4A2.8 2.8 0 0 1 15 6.8V8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
    );
  }

  return <ExternalIcon className="size-5" />;
}

function IconCircleLink({ link, className }: { link: PublicProfileLink; className?: string }) {
  const display = profileLinkPresentation(link);
  if (display.kind) {
    return (
      <a className={cn(buttonVariants({ variant: "secondary" }), "h-auto max-w-full gap-3 whitespace-normal py-2 text-left", className)}
        href={link.url} rel="noreferrer" target="_blank">
        <ProfileDestinationArtwork kind={display.kind} src={display.artworkUrl} />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="block">{display.label}</span>
          <span className="block text-xs font-normal text-muted">{display.platform}</span>
        </span>
        <ExternalIcon className="size-4 shrink-0" />
      </a>
    );
  }
  return (
    <a
      aria-label={link.handle ? `${link.label}: ${link.handle}` : `${link.label}: ${hostLabel(link.url)}`}
      className={cn("lookup-brand-circle", `lookup-brand-circle--${link.type}`, className)}
      href={link.url}
      rel="noreferrer"
      target="_blank"
      title={link.handle ? `${link.label}: ${link.handle}` : `${link.label}: ${hostLabel(link.url)}`}
    >
      <LinkTypeIcon type={link.type} />
    </a>
  );
}

function VrcdnPreviewLink({ link }: { link: { label: string; url: string } }) {
  return (
    <a aria-label={link.label} className="lookup-feature-link" href={link.url} rel="noreferrer" target="_blank">
      <span className="lookup-feature-link__label">{link.label}</span>
      <ExternalIcon className="size-4" />
    </a>
  );
}

function CopyableUrlBar({
  className,
  label,
  labelCh,
  value,
  valueCh,
}: {
  className?: string;
  label: string;
  labelCh?: number;
  value: string;
  valueCh?: number;
}) {
  const urlInputCh = Math.min(Math.max(valueCh ?? value.length, 18), 68);
  const labelWidthCh = Math.max(labelCh ?? label.length, label.length);

  return (
    <div
      className={cn("lookup-primary-url-card", className)}
      style={{ "--lookup-label-ch": labelWidthCh, "--lookup-url-ch": urlInputCh } as CSSProperties}
    >
      <span className="lookup-primary-url-label">{label}</span>
      <input
        aria-label={`${label} URL`}
        className="lookup-primary-url-value"
        readOnly
        title={value}
        value={value}
        onClick={(event) => event.currentTarget.select()}
        onFocus={(event) => event.currentTarget.select()}
      />
      <LookupCopyButton className="lookup-primary-url-copy" label="Copy" value={value} />
    </div>
  );
}

function TwitchFeatureLink({ labelCh, link, valueCh }: { labelCh: number; link: PublicProfileLink; valueCh: number }) {
  return (
    <CopyableUrlBar
      className="lookup-primary-url-card--twitch"
      label="Twitch"
      labelCh={labelCh}
      value={link.url}
      valueCh={valueCh}
    />
  );
}

function CodeCopyBar({
  label,
  labelCh,
  value,
  valueCh,
}: {
  label: string;
  labelCh: number;
  value: string;
  valueCh: number;
}) {
  return <CopyableUrlBar label={label} labelCh={labelCh} value={value} valueCh={valueCh} />;
}

export function PublicProfileLinks({ links }: { links: PublicSearchPerson["outboundLinks"] }) {
  if (links.length === 0) {
    return <span className="text-muted">No public links</span>;
  }

  const explicitVrcdnPreviewLinks = links.filter(isVrcdnPreviewLink);
  const vrcdnStreamLinks = links.filter(isVrcdnStreamLink);
  const twitchCopyLinks = links.filter((link) => link.type === "twitch" && link.presentation === "copy");
  const discordCopyLinks = links.flatMap((link) => {
    if (link.type !== "discord") {
      return [];
    }

    const value = discordCopyValue(link);

    return value ? [{ key: `${link.type}-${link.url}`, label: "Discord", value }] : [];
  });
  const vrcdnPreviewLinks = [
    ...explicitVrcdnPreviewLinks.map((link) => ({ label: link.label, url: link.url })),
    ...vrcdnStreamLinks.flatMap((link) => {
      const previewLink = deriveVrcdnPreviewLink(link.url);

      return previewLink ? [previewLink] : [];
    }),
  ].filter((link, index, allLinks) => allLinks.findIndex((candidate) => candidate.url === link.url) === index);
  const handled = new Set([
    ...explicitVrcdnPreviewLinks,
    ...vrcdnStreamLinks,
    ...twitchCopyLinks,
    ...links.filter((link) => link.type === "discord" && discordCopyValue(link) !== null),
  ]);
  const iconLinks = links.filter((link) => !handled.has(link));
  const vrcdnCopyLinks = vrcdnStreamLinks.flatMap((link) => deriveVrcdnCopyLinks(link.url).map((entry) => ({ ...entry, key: `${link.url}-${entry.label}` })));
  const copyRows = [
    ...discordCopyLinks,
    ...vrcdnCopyLinks,
    ...twitchCopyLinks.map((link) => ({ key: `${link.type}-${link.url}`, label: "Twitch", value: link.url })),
  ];
  const copyValueCh = Math.max(18, ...copyRows.map((row) => row.value.length));
  const copyLabelCh = Math.max(0, ...copyRows.map((row) => row.label.length));
  const hasPrimaryActions = vrcdnPreviewLinks.length > 0 || iconLinks.length > 0;
  const hasCopyRows = copyRows.length > 0;
  const linkBoardStyle = hasCopyRows
    ? ({ "--lookup-board-label-ch": copyLabelCh, "--lookup-board-url-ch": Math.min(Math.max(copyValueCh, 18), 68) } as CSSProperties)
    : undefined;

  return (
    <div className={cn("lookup-link-board", hasCopyRows ? "lookup-link-board--copy-aligned" : undefined)} style={linkBoardStyle}>
      {hasPrimaryActions ? (
        <div className="lookup-link-actions">
          {iconLinks.length > 0 ? (
            <div className="lookup-icon-actions">
              {iconLinks.map((link) => <IconCircleLink key={`${link.type}-${link.url}`} link={link} />)}
            </div>
          ) : null}
          {vrcdnPreviewLinks.map((link) => <VrcdnPreviewLink key={link.url} link={link} />)}
        </div>
      ) : null}
      {hasCopyRows ? (
        <div className="lookup-copy-list">
          {discordCopyLinks.map((entry) => (
            <CodeCopyBar
              key={entry.key}
              label={entry.label}
              labelCh={copyLabelCh}
              value={entry.value}
              valueCh={copyValueCh}
            />
          ))}
          {vrcdnCopyLinks.map((entry) => (
            <CodeCopyBar
              key={entry.key}
              label={entry.label}
              labelCh={copyLabelCh}
              value={entry.value}
              valueCh={copyValueCh}
            />
          ))}
          {twitchCopyLinks.map((link) => (
            <TwitchFeatureLink
              key={`${link.type}-${link.url}`}
              labelCh={copyLabelCh}
              link={link}
              valueCh={copyValueCh}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
