import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { PostHogProvider } from "./PostHogProvider";
import { SiteFooter } from "@/components/ui/site-footer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VRDex",
  description: "A VRChat-first identity, profile, and events platform.",
};

const themeScript = `(() => {
  const stored = window.localStorage.getItem("vrdex-theme");
  const theme = stored === "light" || stored === "dark"
    ? stored
    : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <PostHogProvider>
          <ConvexClientProvider>
            {children}
            {/* Outside the page's `<main>`, and here rather than in `PageShell`,
                so a route that renders its own shell still gets a way out. */}
            <SiteFooter />
          </ConvexClientProvider>
        </PostHogProvider>
      </body>
    </html>
  );

  // Gated on the Clerk key alone, independently of Convex. `ClerkProvider` throws
  // without a publishable key, which would take the whole app down rather than
  // just sign-in — that is why public routes stay renderable in environments with
  // no Clerk credentials, and what lets the public Playwright suites run without
  // auth secrets. But a shell-only preview may carry Clerk credentials while
  // deliberately omitting NEXT_PUBLIC_CONVEX_URL, and `/sign-in` renders `<SignIn>`
  // whenever the key exists; tying the two together made those routes throw on a
  // missing Clerk context. `ConvexClientProvider` degrades on its own.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return shell;
  }

  return <ClerkProvider>{shell}</ClerkProvider>;
}
