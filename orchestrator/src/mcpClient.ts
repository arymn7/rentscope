export type MCPToolName = "crime_summary" | "commute_proxy" | "nearby_pois";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:7000";

export async function callMcpTool<T>(tool: MCPToolName, args: Record<string, unknown>) {
  const response = await fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP ${tool} failed: ${text}`);
  }

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok || !payload.data) {
    throw new Error(payload.error ?? `MCP ${tool} error`);
  }

  return payload.data;
}
