#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ACPServer } from "./server.js";

async function main() {
  const acpServer = new ACPServer();
  const transport = new StdioServerTransport();
  await acpServer.server.connect(transport);
  console.error("ACP MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
