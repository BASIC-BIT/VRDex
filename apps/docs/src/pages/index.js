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
              Docs for VRDex: a self-hostable identity, profiles, and events platform for the VRChat scene.
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
        <section className="container margin-vert--lg docs-lanes">
          <div className="row">
            <div className="col col--4 docs-lane">
              <h2>Public</h2>
              <p>Product behavior, trust labels, claims, privacy, and opt-outs.</p>
              <Link to="/docs/public/">Public docs</Link>
            </div>
            <div className="col col--4 docs-lane">
              <h2>Developers</h2>
              <p>API direction, self-hosting, deployments, and agent integration.</p>
              <Link to="/docs/developers/public-api">Public API posture</Link>
            </div>
            <div className="col col--4 docs-lane">
              <h2>Engineering</h2>
              <p>Architecture, backend, testing, planning, and maintainer workflow notes.</p>
              <Link to="/docs/engineering/">Engineering docs</Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
