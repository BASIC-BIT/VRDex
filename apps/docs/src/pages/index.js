import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

export default function Home() {
  return (
    <Layout title="VRDex Docs" description="VRDex public, developer, and engineering documentation.">
      <main>
        <section className="hero hero--primary">
          <div className="container">
            <h1 className="hero__title">VRDex Docs</h1>
            <p className="hero__subtitle">
              Public, developer, and engineering docs for a self-hostable VRChat scene identity platform.
            </p>
            <div className="button-group">
              <Link className="button button--secondary button--lg" to="/docs/">
                Browse docs
              </Link>
              <Link className="button button--outline button--secondary button--lg" to="/docs/developers/">
                Developer docs
              </Link>
            </div>
          </div>
        </section>
        <section className="container margin-vert--lg">
          <div className="row">
            <div className="col col--4">
              <h2>Public</h2>
              <p>Plain-language product docs for people, communities, trust, claims, and current user-facing behavior.</p>
              <Link to="/docs/public/">Public docs</Link>
            </div>
            <div className="col col--4">
              <h2>Developers</h2>
              <p>Integration and operator docs for the public API, self-hosting, deployments, and agent-facing tools.</p>
              <Link to="/docs/developers/public-api">Public API posture</Link>
            </div>
            <div className="col col--4">
              <h2>Engineering</h2>
              <p>Architecture, planning, backend, testing, and agentic operating notes for maintainers and implementation agents.</p>
              <Link to="/docs/engineering/">Engineering docs</Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
