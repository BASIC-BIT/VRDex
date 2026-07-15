import { stringifyOpenApiYamlDocument } from "@vrdex/api-contracts";

export const dynamic = "force-static";

export async function GET() {
  return new Response(stringifyOpenApiYamlDocument(), {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
    },
  });
}
