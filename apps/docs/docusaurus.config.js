const lightCodeTheme = require("prism-react-renderer").themes.github;
const darkCodeTheme = require("prism-react-renderer").themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "VRDex Docs",
  tagline: "Public, self-hostable VRChat scene identity docs for humans and agents.",
  url: "https://docs.vrdex.net",
  baseUrl: "/",
  organizationName: "BASIC-BIT",
  projectName: "VRDex",
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../../docs",
          routeBasePath: "docs",
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl: ({ docPath }) => `https://github.com/BASIC-BIT/VRDex/edit/main/docs/${docPath}`,
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "VRDex Docs",
      items: [
        { to: "/docs/", label: "Docs", position: "left" },
        { to: "/docs/planning/", label: "Planning", position: "left" },
        { to: "/docs/platform/public-api", label: "Platform", position: "left" },
        { to: "/docs/agentic/", label: "Agentic", position: "left" },
        { href: "https://github.com/BASIC-BIT/VRDex", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Start",
          items: [
            { label: "Docs Home", to: "/docs/" },
            { label: "Planning", to: "/docs/planning/" },
            { label: "Deployment", to: "/docs/deployment/self-hosting-and-iac" },
          ],
        },
        {
          title: "Project",
          items: [{ label: "GitHub", href: "https://github.com/BASIC-BIT/VRDex" }],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} BASIC BIT LLC.`,
    },
    prism: {
      theme: lightCodeTheme,
      darkTheme: darkCodeTheme,
    },
  },
};

module.exports = config;
