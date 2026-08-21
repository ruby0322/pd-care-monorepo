import { getSiteUrl } from "@/lib/blog/seo";
import { buildLlmsTxt } from "@/lib/seo/llms-txt";

export function GET(): Response {
  return new Response(buildLlmsTxt(getSiteUrl()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
