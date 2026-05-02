#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, Client, SessionId } from "@agentclientprotocol/sdk";

// Stateful variables
let childProcess: ChildProcess | null = null;
let connection: ClientSideConnection | null = null;
let currentSessionId: SessionId | null = null;
let responseBuffer = "";
let isGenerating = false;
let currentError: string | null = null;
let generatePromise: Promise<void> | null = null;

const clientImpl: Client = {
  async requestPermission(params) {
    if (params.options && params.options.length > 0) {
      // Find an accept/allow option if we want to auto-allow, or just pick the first one.
      const acceptOption = params.options.find((o: any) => o.kind === "accept" || o.kind === "allow") || params.options[0];
      return { outcome: { outcome: "selected", optionId: acceptOption.optionId } };
    }
    return { outcome: { outcome: "cancelled" } };
  },
  async sessionUpdate(params) {
    if (params.update.sessionUpdate === "agent_message_chunk") {
      const chunk = params.update.content;
      if (chunk.type === "text" && chunk.text) {
        responseBuffer += chunk.text;
      }
    } else if (params.update.sessionUpdate === "tool_call_update") {
        const update = params.update;
        if (update.status === "in_progress") {
            responseBuffer += `\n[Tool call: ${update.title}]\n`;
        }
    }
  }
};

const server = new Server(
  {
    name: "acp-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "initialize_client",
        description: "Initialize the ACP client to connect to an external agent command.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The ACP agent command (e.g., gemini, claude-code-acp).",
            },
            args: {
              type: "array",
              items: { type: "string" },
              description: "Arguments to pass to the agent command.",
            },
            cwd: {
              type: "string",
              description: "Working directory for the agent.",
            },
            env: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Environment variables for the agent.",
            },
            authMethodId: {
              type: "string",
              description: "Auth method ID (e.g., oauth-personal).",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "send_prompt",
        description: "Send a prompt to the connected agent. Starts generation in the background.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The message to send to the agent.",
            },
            wait: {
              type: "boolean",
              description: "If true, waits until the full response is generated before returning. If false, returns immediately with the current buffer.",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "read_response",
        description: "Read the current response from the agent.",
        inputSchema: {
          type: "object",
          properties: {
            wait: {
              type: "boolean",
              description: "If true, waits until the full response is generated before returning. If false, returns immediately with the current buffer.",
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "initialize_client") {
      const { command, args: agentArgs = [], cwd = process.cwd(), env, authMethodId } = args as any;

      if (childProcess) {
        childProcess.kill();
        childProcess = null;
      }
      
      const spawnEnv = { ...process.env, ...(env || {}) };

      childProcess = spawn(command, agentArgs, {
        cwd,
        env: spawnEnv,
        stdio: ["pipe", "pipe", "inherit"],
      });

      const webStdout = Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>;
      const webStdin = Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>;

      const stream = ndJsonStream(webStdin, webStdout);

      connection = new ClientSideConnection((agent) => clientImpl, stream);

      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "acp-mcp-server", version: "1.0.0" }
      });

      if (authMethodId) {
        await connection.authenticate({ methodId: authMethodId });
      }

      const sessionResponse = await connection.newSession({
        cwd,
        mcpServers: []
      });

      currentSessionId = sessionResponse.sessionId;
      responseBuffer = "";
      isGenerating = false;
      generatePromise = null;
      currentError = null;

      return {
        content: [{ type: "text", text: `Client initialized successfully for command: ${command}` }],
      };
    }

    if (name === "send_prompt") {
      if (!connection || !currentSessionId) {
        throw new Error("Client not initialized. Call initialize_client first.");
      }

      if (isGenerating) {
        throw new Error("A generation is already in progress. Wait for it to finish before sending a new prompt.");
      }

      const { prompt, wait = false } = args as any;
      responseBuffer = "";
      isGenerating = true;
      currentError = null;

      // Start the stream asynchronously
      generatePromise = (async () => {
        try {
          await connection!.prompt({
            sessionId: currentSessionId!,
            prompt: [{ type: "text", text: prompt }]
          });
        } catch (err: any) {
          currentError = err.message || String(err);
        } finally {
          isGenerating = false;
        }
      })();

      if (wait) {
        await generatePromise;
        const status = currentError ? "error" : "complete";
        let text = `Status: ${status}\n\nResponse:\n${responseBuffer}`;
        if (currentError) {
          text += `\n\nError: ${currentError}`;
        }
        return {
          content: [{ type: "text", text }],
        };
      }

      return {
        content: [{ type: "text", text: "Prompt sent successfully. Generation started in the background. Use read_response to view." }],
      };
    }

    if (name === "read_response") {
      const { wait = false } = (args || {}) as any;

      if (wait && generatePromise) {
        await generatePromise;
      }

      const status = isGenerating ? "generating" : (currentError ? "error" : "complete");
      let text = `Status: ${status}\n\nResponse:\n${responseBuffer}`;

      if (currentError) {
        text += `\n\nError: ${currentError}`;
      }

      return {
        content: [{ type: "text", text }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: err.message || String(err) }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ACP MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  if (childProcess) childProcess.kill();
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  if (childProcess) childProcess.kill();
  process.exit(0);
});
