import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function verify() {
  console.log("🚀 Verifying refactored tools and structured output...");

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    stderr: "inherit",
  });

  const client = new Client(
    { name: "verify-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP Server");

    // 1. Initialize Gemini
    console.log("\n1️⃣ Initializing gemini...");
    const initRes = await client.callTool({
      name: "initialize_client",
      arguments: { agent: "gemini", connectionId: "v-session" },
    });
    console.log("Result (Should be multi-line content):", JSON.stringify(initRes.content, null, 2));

    // 2. Test send_prompt in 'poll' mode (Default)
    console.log("\n2️⃣ Sending prompt with mode='poll'...");
    const sendRes = await client.callTool({
      name: "send_prompt",
      arguments: {
        connectionId: "v-session",
        prompt: "Say hello",
        mode: "poll"
      },
    });
    console.log("Result (Should show 'started' and initial status):", JSON.stringify(sendRes.content, null, 2));

    // 3. Test read_response in 'poll' mode
    console.log("\n3️⃣ Reading response with mode='poll'...");
    const readRes = await client.callTool({
      name: "read_response",
      arguments: { connectionId: "v-session", mode: "poll" },
    });
    console.log("Result (Current snapshot):", JSON.stringify(readRes.content, null, 2));

    // 4. Test read_response in 'wait' mode
    console.log("\n4️⃣ Reading response with mode='wait' (Blocking)...");
    const waitRes = await client.callTool({
      name: "read_response",
      arguments: { connectionId: "v-session", mode: "wait" },
    });
    console.log("Result (Final response content):", JSON.stringify(waitRes.content, null, 2));

    // 5. Test send_prompt in 'interrupt' mode
    console.log("\n5️⃣ Testing interrupt mode (Appending)...");
    // We send a long request first
    await client.callTool({
      name: "send_prompt",
      arguments: { connectionId: "v-session", prompt: "Write a long story", mode: "poll" },
    });
    
    // Then interrupt/append
    const interruptRes = await client.callTool({
      name: "send_prompt",
      arguments: {
        connectionId: "v-session",
        prompt: "Actually, just write one sentence.",
        mode: "interrupt"
      },
    });
    console.log("Result (Should show 'appended' and NOT reset buffer):", JSON.stringify(interruptRes.content, null, 2));

    // 6. Cleanup
    await client.callTool({
      name: "close_connection",
      arguments: { connectionId: "v-session" },
    });

    console.log("\n✨ Verification completed!");
  } catch (error) {
    console.error("\n❌ Verification failed:", error);
  } finally {
    process.exit(0);
  }
}

verify();
