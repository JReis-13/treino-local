import proxy from "@/lib/connector/proxy.cjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function POST(request: Request): Promise<Response> {
  return proxy.handleConnectorRequest(request);
}
