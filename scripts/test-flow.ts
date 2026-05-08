import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

async function testFlow() {
  console.log("🚀 Starting MCP-ACP Bridge Flow Test...");

  // 1. Initialize Transport (running the server via bun)
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    stderr: "inherit",
  });

  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  try {
    // 2. Connect to the server
    await client.connect(transport);
    console.log("✅ Connected to MCP Server");

    // 3. List available tools
    const tools = await client.listTools();
    console.log(`📦 Available tools: ${tools.tools.map(t => t.name).join(", ")}`);

    // 4. Test initialize_client (using Gemini as it's usually installed)
    console.log("\n🛠️ Testing 'initialize_client' for gemini...");
    const initResult = await client.callTool({
      name: "initialize_client",
      arguments: {
        agent: "gemini",
        connectionId: "test-session",
      },
    });
    console.log("📄 Result:", JSON.stringify(initResult, null, 2));

    // 5. List connections to verify
    console.log("\n📋 Listing active connections...");
    const listResult = await client.callTool({
      name: "list_connections",
      arguments: {},
    });
    console.log("📄 Result:", JSON.stringify(listResult, null, 2));

    // 6. Test a failing initialization (agent not installed)
    console.log("\n🛠️ Testing 'initialize_client' for opencode (simulating missing binary)...");
    try {
      await client.callTool({
        name: "initialize_client",
        arguments: {
          agent: "opencode",
          connectionId: "fail-session",
        },
      });
    } catch (error: any) {
      console.log("✅ Correctly caught expected error:");
      console.log(error.message);
    }

    // 7. Cleanup
    console.log("\n🧹 Closing connection...");
    await client.callTool({
      name: "close_connection",
      arguments: {
        connectionId: "test-session",
      },
    });

    console.log("\n✨ Flow test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  } finally {
    process.exit(0);
  }
}

testFlow();
