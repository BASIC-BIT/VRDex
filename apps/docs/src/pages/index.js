import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

export default function Home() {
  return (
    <Layout title="VRDex Docs" description="VRDex product, platform, and agentic delivery documentation.">
      <main>
        <section className="hero hero--primary">
          <div className="container">
            <h1 className="hero__title">VRDex Docs</h1>
            <p className="hero__subtitle">
              Public, self-hostable VRChat scene identity docs for humans, contributors, and agent integrations.
            </p>
            <div className="button-group">
              <Link className="button button--secondary button--lg" to="/docs/">
                Browse docs
              </Link>
              <Link className="button button--outline button--secondary button--lg" to="/docs/deployment/self-hosting-and-iac">
                Deployment direction
              </Link>
            </div>
          </div>
        </section>
        <section className="container margin-vert--lg">
          <div className="row">
            <div className="col col--4">
              <h2>Product</h2>
              <p>Planning docs describe profile, claim, discovery, event, world, and partner-facing product rules.</p>
              <Link to="/docs/planning/">Planning index</Link>
            </div>
            <div className="col col--4">
              <h2>Platform</h2>
              <p>Platform docs define API posture, self-hosting expectations, and infrastructure ownership boundaries.</p>
              <Link to="/docs/platform/public-api">Public API posture</Link>
            </div>
            <div className="col col--4">
              <h2>Agentic</h2>
              <p>Agentic docs capture the repo's contributor workflow, review loops, and software-factory conventions.</p>
              <Link to="/docs/agentic/">Agentic docs</Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
