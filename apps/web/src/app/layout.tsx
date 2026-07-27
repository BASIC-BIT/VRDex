import type { Metadata } from "next";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { PostHogProvider } from "./PostHogProvider";
import { authSessionCredentialPresent } from "@/lib/auth-session";
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
  const credentialPresent = process.env.NEXT_PUBLIC_CONVEX_URL
    ? authSessionCredentialPresent(
        (await cookies()).getAll().map(({ name }) => name),
      )
    : false;
  const shell = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <PostHogProvider>
          <ConvexClientProvider credentialPresent={credentialPresent}>
            {children}
          </ConvexClientProvider>
        </PostHogProvider>
      </body>
    </html>
  );

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return shell;
  }

  return <ConvexAuthNextjsServerProvider>{shell}</ConvexAuthNextjsServerProvider>;
}
