import Link from "next/link";

/**
 * The only global surface that links anything but the nav's three utilities.
 *
 * Both support routes below were unreachable before this existed. `/developers`
 * was linked from nowhere outside `/developers`, and the request form was linked
 * from nowhere at all, which is how a structured intake for opt-out and
 * pre-claim safety review sat unused behind a URL nobody could find. A support
 * page nobody can reach is not a support page, so the entry point ships with it.
 *
 * Four links, deliberately. This is a way out of a dead end, not a sitemap, and
 * everything else here is already reachable from discovery or the nav. The repo
 * link is here on the same grounds: the project is open source under MIT, and
 * the code is unreachable from anywhere else on the site.
 */
const FOOTER_LINKS = [
  { href: "/support", label: "Contact" },
  // Same page, different topic already chosen. Opt-out and safety review are
  // what someone arrives for when the word they have in mind is "privacy"
  // rather than "contact", and neither would guess the other's name.
  { href: "/support?topic=owner_opt_out", label: "Privacy request" },
  { href: "/developers/api", label: "Developers" },
  { href: "https://github.com/BASIC-BIT/VRDex", label: "GitHub" },
];

const FOOTER_LINK_CLASS = "text-muted underline-offset-4 transition hover:text-foreground hover:underline";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-4 py-8 text-sm sm:px-10 lg:px-16">
      <nav
        aria-label="Site"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3"
      >
        <span className="font-mono text-xs uppercase text-muted">VRDex</span>
        {FOOTER_LINKS.map((link) =>
          link.href.startsWith("http") ? (
            <a className={FOOTER_LINK_CLASS} href={link.href} key={link.href} rel="noreferrer" target="_blank">
              {link.label}
            </a>
          ) : (
            <Link className={FOOTER_LINK_CLASS} href={link.href} key={link.href}>
              {link.label}
            </Link>
          ),
        )}
      </nav>
    </footer>
  );
}
