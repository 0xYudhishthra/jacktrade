// Talks to the hosted connector with the official MCP client over Streamable HTTP, the same
// transport Grok's custom connectors use: initialize → tools/list → read-only tool calls.
//
//   node test/mcp-client.live.ts <mcp-url> [bet-id]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url, betId] = process.argv.slice(2);
if (!url) throw new Error("usage: node test/mcp-client.live.ts <mcp-url> [bet-id]");

const client = new Client({ name: "jacktrade-live-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
console.log("server:", JSON.stringify(client.getServerVersion()), "| instructions:", Boolean(client.getInstructions()));

const { tools } = await client.listTools();
console.log(`tools (${tools.length}):`, tools.map((t) => t.name).join(", "));

const text = (r: any) => r.content?.[0]?.text ?? JSON.stringify(r);
for (const [name, args] of [
  ["list_markets", {}],
  ["house_status", {}],
  ["quote_bet", { market: "ETH", side: "long", margin_usd: 2, leverage: 50 }],
  ...(betId ? [["make_it_real", { bet_id: betId }]] : []),
] as [string, Record<string, unknown>][]) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n== ${name}${r.isError ? " (error)" : ""}\n${text(r).slice(0, 700)}`);
}
await client.close();
