import Link from "next/link";
import { getOpenApiDocument } from "@vrdex/api-contracts";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";

export const dynamic = "force-static";

const httpMethods = ["get", "post", "put", "patch", "delete"] as const;

type ApiOperation = {
  method: string;
  operationId: string;
  path: string;
  responseCodes: string[];
  summary: string;
  tags: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function collectOperations(): ApiOperation[] {
  const document = getOpenApiDocument();
  const paths = document.paths ?? {};

  return Object.entries(paths)
    .flatMap(([path, pathItem]) => {
      if (!isRecord(pathItem)) {
        return [];
      }

      return httpMethods.flatMap((method) => {
        const operation = pathItem[method];

        if (!isRecord(operation)) {
          return [];
        }

        const responses = isRecord(operation.responses) ? operation.responses : {};

        return [
          {
            method: method.toUpperCase(),
            operationId: textValue(operation.operationId, `${method}:${path}`),
            path,
            responseCodes: Object.keys(responses),
            summary: textValue(operation.summary, path),
            tags: stringList(operation.tags),
          },
        ];
      });
    })
    .sort((first, second) => first.path.localeCompare(second.path) || first.method.localeCompare(second.method));
}

function methodTone(method: string) {
  return method === "GET"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-accent/25 bg-accent/10 text-accent-strong";
}

export default function ApiReferencePage() {
  const document = getOpenApiDocument();
  const operations = collectOperations();
  const tags = document.tags ?? [];

  return (
    <PageShell className="py-8 sm:py-10">
      <PageContainer max="7xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap items-center gap-2">
            <a className={buttonVariants({ variant: "secondary" })} href="/api/v0/openapi.json">
              OpenAPI JSON
            </a>
            <Link className={buttonVariants({ variant: "ghost" })} href="/">
              Home
            </Link>
          </div>
        </PageNav>

        <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-5">
            <div className="rounded-panel border border-border bg-surface px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                    {document.info.title}
                  </h1>
                  <p className="mt-2 font-mono text-xs uppercase tracking-[0.22em] text-muted">
                    OpenAPI {document.openapi} / {document.info.version}
                  </p>
                </div>
                <span className="rounded-control border border-border bg-surface-strong px-3 py-2 font-mono text-xs">
                  {operations.length} operations
                </span>
              </div>
            </div>

            <Card>
              <h2 className="text-lg font-semibold">Tags</h2>
              <div className="mt-4 grid gap-3">
                {tags.map((tag) => (
                  <div className="border-b border-border pb-3 last:border-0 last:pb-0" key={tag.name}>
                    <div className="font-medium">{tag.name}</div>
                    {"description" in tag && typeof tag.description === "string" ? (
                      <p className="mt-1 text-sm leading-6 text-muted">{tag.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <section className="grid gap-3">
            {operations.map((operation) => (
              <Card className="grid gap-4 sm:grid-cols-[7.5rem_1fr]" key={operation.operationId} padding="sm">
                <div>
                  <span
                    className={cn(
                      "inline-flex min-w-16 justify-center rounded-control border px-2.5 py-1.5 font-mono text-xs font-semibold",
                      methodTone(operation.method),
                    )}
                  >
                    {operation.method}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all font-mono text-sm text-foreground">{operation.path}</code>
                    {operation.tags.map((tag) => (
                      <span className="font-mono text-xs text-muted" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{operation.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {operation.responseCodes.map((code) => (
                      <span className="rounded-control border border-border bg-surface-strong px-2 py-1 font-mono text-xs" key={code}>
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </section>
        </section>
      </PageContainer>
    </PageShell>
  );
}
