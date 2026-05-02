import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, SessionId } from "@agentclientprotocol/sdk";
import { PRECONFIGURED_AGENTS } from "./config.js";
import { ACPClientHandler } from "./client.js";

interface ACPConnectionState {
  connectionId: string;
  agentName: string;
  cwd: string;
  childProcess: ChildProcess;
  connection: ClientSideConnection;
  sessionId: SessionId;
  clientHandler: ACPClientHandler;
  isGenerating: boolean;
  currentError: string | null;
  generatePromise: Promise<void> | null;
}

export class ACPServer {
  public server: Server;
  private connections = new Map<string, ACPConnectionState>();

  constructor() {
    this.server = new Server(
      {
        name: "mcp-acp-bridge",
        version: "1.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupCleanup();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const agentKeys = Object.keys(PRECONFIGURED_AGENTS).map(k => `"${k}"`).join(", ");
      return {
        tools: [
          {
            name: "initialize_client",
            description: "Initialize a new ACP connection using a preconfigured agent.",
            inputSchema: {
              type: "object",
              properties: {
                agent: {
                  type: "string",
                  description: `The preconfigured agent to connect to (e.g., ${agentKeys}).`,
                  enum: Object.keys(PRECONFIGURED_AGENTS)
                },
                connectionId: {
                  type: "string",
                  description: "Unique identifier for this connection. If already exists, the old one will be replaced.",
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
              required: ["agent", "connectionId"],
            },
          },
          {
            name: "send_prompt",
            description: "Send a prompt to a specific connected agent.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: {
                  type: "string",
                  description: "The ID of the connection to use.",
                },
                prompt: {
                  type: "string",
                  description: "The message to send to the agent.",
                },
                wait: {
                  type: "boolean",
                  description: "If true, waits until the full response is generated before returning.",
                },
              },
              required: ["connectionId", "prompt"],
            },
          },
          {
            name: "read_response",
            description: "Read the current response from a specific agent.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: {
                  type: "string",
                  description: "The ID of the connection to read from.",
                },
                wait: {
                  type: "boolean",
                  description: "If true, waits until the full response is generated before returning.",
                },
              },
              required: ["connectionId"],
            },
          },
          {
            name: "list_connections",
            description: "List all active ACP connections and their status.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "close_connection",
            description: "Close a specific ACP connection.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: {
                  type: "string",
                  description: "The ID of the connection to close.",
                },
              },
              required: ["connectionId"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "initialize_client") {
          const { agent, connectionId, cwd, env, authMethodId } = args as any;

          const config = PRECONFIGURED_AGENTS[agent];
          if (!config) {
             throw new Error(`Agent '${agent}' is not preconfigured. Available agents: ${Object.keys(PRECONFIGURED_AGENTS).join(", ")}`);
          }

          const finalCwd = cwd || config.defaultCwd || process.cwd();

          // Cleanup existing connection with same ID
          const existing = this.connections.get(connectionId);
          if (existing) {
            existing.childProcess.kill();
            this.connections.delete(connectionId);
          }
          
          const spawnEnv = { ...process.env, ...(env || {}) };
          const childProcess = spawn(config.command, config.args, {
            cwd: finalCwd,
            env: spawnEnv,
            stdio: ["pipe", "pipe", "inherit"],
          });

          const webStdout = Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>;
          const webStdin = Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>;

          const stream = ndJsonStream(webStdin, webStdout);
          const clientHandler = new ACPClientHandler();
          const connection = new ClientSideConnection((_) => clientHandler.getClientImpl(), stream);

          await connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: { name: "mcp-acp-bridge", version: "1.1.0" }
          });

          if (authMethodId) {
            await connection.authenticate({ methodId: authMethodId });
          }

          const sessionResponse = await connection.newSession({
            cwd: finalCwd,
            mcpServers: []
          });

          const state: ACPConnectionState = {
            connectionId,
            agentName: agent,
            cwd: finalCwd,
            childProcess,
            connection,
            sessionId: sessionResponse.sessionId,
            clientHandler,
            isGenerating: false,
            currentError: null,
            generatePromise: null,
          };

          this.connections.set(connectionId, state);

          return {
            content: [{ type: "text", text: `Client '${connectionId}' initialized successfully for agent: ${agent} (CWD: ${finalCwd})` }],
          };
        }

        if (name === "send_prompt") {
          const { connectionId, prompt, wait = false } = args as any;
          const state = this.connections.get(connectionId);
          
          if (!state) {
            throw new Error(`Connection '${connectionId}' not found. Call initialize_client first.`);
          }

          if (state.isGenerating) {
            throw new Error(`Connection '${connectionId}' is already in progress. Wait for it to finish.`);
          }

          state.clientHandler.resetBuffer();
          state.isGenerating = true;
          state.currentError = null;

          // Start the stream asynchronously
          state.generatePromise = (async () => {
            try {
              await state.connection.prompt({
                sessionId: state.sessionId,
                prompt: [{ type: "text", text: prompt }]
              });
            } catch (err: any) {
              state.currentError = err.message || String(err);
            } finally {
              state.isGenerating = false;
            }
          })();

          if (wait) {
            await state.generatePromise;
            const status = state.currentError ? "error" : "complete";
            let text = `Status: ${status}\n\nResponse:\n${state.clientHandler.responseBuffer}`;
            if (state.currentError) {
              text += `\n\nError: ${state.currentError}`;
            }
            return {
              content: [{ type: "text", text }],
            };
          }

          return {
            content: [{ type: "text", text: `Prompt sent to '${connectionId}'. Use read_response to view.` }],
          };
        }

        if (name === "read_response") {
          const { connectionId, wait = false } = args as any;
          const state = this.connections.get(connectionId);
          
          if (!state) {
            throw new Error(`Connection '${connectionId}' not found.`);
          }

          if (wait && state.generatePromise) {
            await state.generatePromise;
          }

          const status = state.isGenerating ? "generating" : (state.currentError ? "error" : "complete");
          let text = `Status: ${status}\n\nResponse:\n${state.clientHandler.responseBuffer}`;

          if (state.currentError) {
            text += `\n\nError: ${state.currentError}`;
          }

          return {
            content: [{ type: "text", text }],
          };
        }

        if (name === "list_connections") {
          if (this.connections.size === 0) {
            return {
              content: [{ type: "text", text: "No active connections." }],
            };
          }

          const lines = Array.from(this.connections.values()).map(s => {
            const status = s.isGenerating ? "Generating" : (s.currentError ? "Error" : "Idle");
            return `- ${s.connectionId} (${s.agentName}): ${status} | CWD: ${s.cwd}`;
          });

          return {
            content: [{ type: "text", text: `Active Connections:\n${lines.join("\n")}` }],
          };
        }

        if (name === "close_connection") {
          const { connectionId } = args as any;
          const state = this.connections.get(connectionId);
          if (state) {
            state.childProcess.kill();
            this.connections.delete(connectionId);
            return {
              content: [{ type: "text", text: `Connection '${connectionId}' closed.` }],
            };
          }
          throw new Error(`Connection '${connectionId}' not found.`);
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: err.message || String(err) }],
        };
      }
    });
  }

  private setupCleanup() {
    const cleanup = () => {
      for (const state of this.connections.values()) {
        state.childProcess.kill();
      }
      this.connections.clear();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
