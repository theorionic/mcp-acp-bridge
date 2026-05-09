import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function verifyErrors() {
  console.log("🚀 Verifying Error Propagation Logic...");

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
  });

  const client = new Client(
    { name: "error-verify-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP Server");

    // We modify the config temporarily or use the 'agent' parameter if we can override the command
    // Since we can't easily override the preconfigured agent command without modifying config.ts,
    // let's just try to initialize something that will fail and check the error reporting.
    
    console.log("\n🛠️ Attempting to initialize a failing agent (simulated)...");
    
    // We'll use a trick: point to our mock script using the 'cwd' or other params if the server allows,
    // but the safest way is to just call initialize_client with a missing agent to see the standard error handling,
    // OR mock the config.ts for a moment.
    
    try {
      const res = await client.callTool({
        name: "initialize_client",
        arguments: {
          agent: "gemini", 
          connectionId: "fail-session",
          extraArgs: ["--invalid-flag-to-trigger-stderr"]
        },
      });
      console.log("Result:", JSON.stringify(res, null, 2));
    } catch (error: any) {
      console.log("✅ Caught expected initialization error.");
      console.log("Error Detail (Should contain stderr logs):", error.message);
    }

  } catch (error) {
    console.error("❌ Verification failed:", error);
  } finally {
    process.exit(0);
  }
}

verifyErrors();
