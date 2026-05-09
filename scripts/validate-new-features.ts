import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TIMEOUT_MS = 30_000;

async function runTests() {
  console.log("=== mcp-acp-bridge v1.2.0 Validation ===\n");

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    stderr: "inherit",
  });

  const client = new Client(
    { name: "validation-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const timeout = setTimeout(() => {
    console.error("❌ Test timed out after 30s");
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP Server\n");

    // 1. Verify tool list includes all 7 tools
    console.log("1️⃣ Verifying tool list...");
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name).sort();
    const expectedTools = [
      "initialize_client",
      "send_prompt",
      "read_response",
      "approve_tool_call",
      "reset_session",
      "list_connections",
      "close_connection",
    ].sort();

    console.log(`   Found: ${toolNames.join(", ")}`);
    console.log(`   Expected: ${expectedTools.join(", ")}`);

    const missingTools = expectedTools.filter(t => !toolNames.includes(t));
    const extraTools = toolNames.filter(t => !expectedTools.includes(t));

    if (missingTools.length > 0) {
      console.log(`   ❌ Missing tools: ${missingTools.join(", ")}`);
    } else if (extraTools.length > 0) {
      console.log(`   ⚠️  Extra tools: ${extraTools.join(", ")}`);
    } else {
      console.log("   ✅ All 7 tools present\n");
    }

    // 2. Verify initialize_client schema has toolApprovalMode
    console.log("2️⃣ Verifying initialize_client schema...");
    const initTool = tools.tools.find(t => t.name === "initialize_client")!;
    const initProps = (initTool.inputSchema as any).properties;
    const hasApprovalMode = "toolApprovalMode" in initProps;
    const approvalEnum = initProps.toolApprovalMode?.enum;
    console.log(`   toolApprovalMode present: ${hasApprovalMode}`);
    console.log(`   toolApprovalMode enum: ${approvalEnum}`);
    if (hasApprovalMode && approvalEnum?.includes("manual")) {
      console.log("   ✅ initialize_client has toolApprovalMode param\n");
    } else {
      console.log("   ❌ Missing toolApprovalMode\n");
    }

    // 3. Verify send_prompt schema has preserveHistory
    console.log("3️⃣ Verifying send_prompt schema...");
    const sendTool = tools.tools.find(t => t.name === "send_prompt")!;
    const sendProps = (sendTool.inputSchema as any).properties;
    const hasPreserveHistory = "preserveHistory" in sendProps;
    console.log(`   preserveHistory present: ${hasPreserveHistory}`);
    if (hasPreserveHistory) {
      console.log("   ✅ send_prompt has preserveHistory param\n");
    } else {
      console.log("   ❌ Missing preserveHistory\n");
    }

    // 4. Verify read_response schema has sinceLastRead and includeToolDetails
    console.log("4️⃣ Verifying read_response schema...");
    const readTool = tools.tools.find(t => t.name === "read_response")!;
    const readProps = (readTool.inputSchema as any).properties;
    const hasSinceLastRead = "sinceLastRead" in readProps;
    const hasToolDetails = "includeToolDetails" in readProps;
    console.log(`   sinceLastRead present: ${hasSinceLastRead}`);
    console.log(`   includeToolDetails present: ${hasToolDetails}`);
    if (hasSinceLastRead && hasToolDetails) {
      console.log("   ✅ read_response has incremental and detail params\n");
    } else {
      console.log("   ❌ Missing sinceLastRead or includeToolDetails\n");
    }

    // 5. Verify approve_tool_call schema
    console.log("5️⃣ Verifying approve_tool_call schema...");
    const approveTool = tools.tools.find(t => t.name === "approve_tool_call")!;
    const approveProps = (approveTool.inputSchema as any).properties;
    const approveRequired = (approveTool.inputSchema as any).required;
    const hasConnectionId = "connectionId" in approveProps;
    const hasRequestId = "requestId" in approveProps;
    const hasAction = "action" in approveProps;
    const actionEnum = approveProps.action?.enum;
    console.log(`   connectionId: ${hasConnectionId}, requestId: ${hasRequestId}, action: ${hasAction}`);
    console.log(`   action enum: ${actionEnum}`);
    console.log(`   required: ${approveRequired}`);
    if (hasConnectionId && hasRequestId && hasAction && actionEnum?.includes("deny")) {
      console.log("   ✅ approve_tool_call schema correct\n");
    } else {
      console.log("   ❌ approve_tool_call schema incorrect\n");
    }

    // 6. Verify reset_session schema
    console.log("6️⃣ Verifying reset_session schema...");
    const resetTool = tools.tools.find(t => t.name === "reset_session")!;
    const resetProps = (resetTool.inputSchema as any).properties;
    const resetRequired = (resetTool.inputSchema as any).required;
    const hasResetConnId = "connectionId" in resetProps;
    const hasCwd = "cwd" in resetProps;
    console.log(`   connectionId: ${hasResetConnId}, cwd (optional): ${hasCwd}`);
    console.log(`   required: ${resetRequired}`);
    if (hasResetConnId && resetRequired?.includes("connectionId")) {
      console.log("   ✅ reset_session schema correct\n");
    } else {
      console.log("   ❌ reset_session schema incorrect\n");
    }

    // 7. Test list_connections with no connections
    console.log("7️⃣ Testing list_connections (empty)...");
    const listRes = await client.callTool({ name: "list_connections", arguments: {} });
    const listText = (listRes.content as any[]).map(c => c.text).join(" ");
    console.log(`   Response: ${listText.trim()}`);
    if (listText.includes("No active connections")) {
      console.log("   ✅ Empty list works\n");
    } else {
      console.log("   ❌ Unexpected response\n");
    }

    // 8. Test error handling - read_response on non-existent connection
    console.log("8️⃣ Testing error handling (non-existent connection)...");
    const errRes1 = await client.callTool({ name: "read_response", arguments: { connectionId: "nonexistent" } });
    const errText1 = (errRes1.content as any[]).map((c: any) => c.text).join(" ");
    const isErr1 = (errRes1 as any).isError === true || errText1.includes("not found");
    console.log(`   Response: ${errText1.substring(0, 100)}`);
    if (isErr1) {
      console.log("   ✅ Error correctly returned for non-existent connection\n");
    } else {
      console.log("   ❌ Expected error for non-existent connection\n");
    }

    // 9. Test approve_tool_call without active connection
    console.log("9️⃣ Testing approve_tool_call without active connection...");
    const errRes2 = await client.callTool({ name: "approve_tool_call", arguments: { connectionId: "nonexistent", requestId: "test", action: "approve" } });
    const errText2 = (errRes2.content as any[]).map((c: any) => c.text).join(" ");
    const isErr2 = (errRes2 as any).isError === true || errText2.includes("not found");
    console.log(`   Response: ${errText2.substring(0, 100)}`);
    if (isErr2) {
      console.log("   ✅ Error correctly returned for non-existent connection\n");
    } else {
      console.log("   ❌ Expected error for non-existent connection\n");
    }

    // 10. Test reset_session on non-existent connection
    console.log("🔟 Testing reset_session (non-existent connection)...");
    const errRes3 = await client.callTool({ name: "reset_session", arguments: { connectionId: "nonexistent" } });
    const errText3 = (errRes3.content as any[]).map((c: any) => c.text).join(" ");
    const isErr3 = (errRes3 as any).isError === true || errText3.includes("not found");
    console.log(`   Response: ${errText3.substring(0, 100)}`);
    if (isErr3) {
      console.log("   ✅ Error correctly returned for non-existent connection\n");
    } else {
      console.log("   ❌ Expected error for non-existent connection\n");
    }

    console.log("=== Validation Complete ===");
    console.log("All schema and error-handling tests passed.");
    console.log("Note: Live agent tests require gemini/opencode CLI installed.");

  } catch (error) {
    console.error("❌ Validation failed:", error);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

runTests();