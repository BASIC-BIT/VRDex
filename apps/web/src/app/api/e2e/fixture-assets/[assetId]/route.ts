import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FixtureAssetRouteProps = {
  params: Promise<{
    assetId: string;
  }>;
};

type FixtureAsset = {
  title: string;
  subtitle: string;
  initials: string;
  width: number;
  height: number;
  from: string;
  to: string;
  accent: string;
  showText?: boolean;
};

const fixtureAssets: Record<string, FixtureAsset> = {
  "fixture-aurora-profile-image": {
    title: "DJ Aurora",
    subtitle: "Melodic house",
    initials: "DA",
    width: 960,
    height: 960,
    from: "#16111f",
    to: "#d66a4d",
    accent: "#f5c06f",
  },
  "fixture-aurora-primary-logo": {
    title: "AURORA",
    subtitle: "Primary logo",
    initials: "A",
    width: 1200,
    height: 675,
    from: "#0b1020",
    to: "#7c3aed",
    accent: "#67e8f9",
  },
  "fixture-aurora-alt-logo": {
    title: "A",
    subtitle: "Square mark",
    initials: "A",
    width: 960,
    height: 960,
    from: "#2f211b",
    to: "#f97316",
    accent: "#fde68a",
  },
  "fixture-afterglow-event-poster": {
    title: "Afterglow Harbor",
    subtitle: "Harbor sessions",
    initials: "AG",
    width: 1200,
    height: 675,
    from: "#111827",
    to: "#0e7490",
    accent: "#fb7185",
  },
  "fixture-afterglow-event-banner": {
    title: "Afterglow Harbor banner",
    subtitle: "Hero artwork",
    initials: "",
    width: 1600,
    height: 700,
    from: "#121629",
    to: "#134e67",
    accent: "#fb7185",
    showText: false,
  },
  "fixture-afterglow-event-thumbnail": {
    title: "Afterglow Harbor card",
    subtitle: "Event thumbnail",
    initials: "AG",
    width: 960,
    height: 960,
    from: "#2b1721",
    to: "#0e7490",
    accent: "#fb7185",
  },
};

function fixtureError(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status });
}

function fixtureRequestAllowed() {
  const productionBlocked =
    process.env.VERCEL_ENV === "production" &&
    process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS !== "true";

  return !productionBlocked && process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSvg(asset: FixtureAsset) {
  const title = escapeSvgText(asset.title);
  const subtitle = escapeSvgText(asset.subtitle);
  const initials = escapeSvgText(asset.initials);
  const radius = Math.min(asset.width, asset.height) * 0.24;

  const text = asset.showText === false
    ? ""
    : `
  <text x="8%" y="48%" fill="white" font-family="Inter, Arial, sans-serif" font-size="${Math.round(asset.height * 0.24)}" font-weight="800" letter-spacing="-6">${initials}</text>
  <text x="8%" y="72%" fill="white" font-family="Inter, Arial, sans-serif" font-size="${Math.round(asset.height * 0.1)}" font-weight="750" letter-spacing="-2">${title}</text>
  <text x="8%" y="84%" fill="white" fill-opacity="0.72" font-family="Inter, Arial, sans-serif" font-size="${Math.round(asset.height * 0.046)}" font-weight="600" letter-spacing="2">${subtitle.toUpperCase()}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${asset.width} ${asset.height}" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${asset.from}"/>
      <stop offset="1" stop-color="${asset.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="22%" r="72%">
      <stop offset="0" stop-color="${asset.accent}" stop-opacity="0.78"/>
      <stop offset="0.46" stop-color="${asset.accent}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${asset.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${asset.width}" height="${asset.height}" fill="url(#bg)" rx="${radius}"/>
  <rect width="${asset.width}" height="${asset.height}" fill="url(#glow)" rx="${radius}"/>
  <circle cx="${asset.width * 0.18}" cy="${asset.height * 0.2}" r="${Math.min(asset.width, asset.height) * 0.16}" fill="none" stroke="white" stroke-opacity="0.26" stroke-width="10"/>
  ${text}
</svg>`;
}

export async function GET(_request: Request, { params }: FixtureAssetRouteProps) {
  if (!fixtureRequestAllowed()) {
    return fixtureError("Fixture assets are not enabled for this request.");
  }

  const asset = fixtureAssets[(await params).assetId];
  if (!asset) {
    return fixtureError("Unknown fixture asset.", 404);
  }

  return new NextResponse(renderSvg(asset), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
