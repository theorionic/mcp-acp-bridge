import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess, execSync } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, SessionId } from "@agentclientprotocol/sdk";
import { PRECONFIGURED_AGENTS } from "./config.js";
import { ACPClientHandler } from "./client.js";

function checkBinaryExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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
        version: "1.1.8",
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
    this.setupCleanup();
  }

  private setupHandlers() {
    // 1. Tool Handlers (5 Tools)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const agentKeys = Object.keys(PRECONFIGURED_AGENTS).join(", ");
      return {
        tools: [
          {
            name: "initialize_client",
            description: `Initialize a new ACP agent connection. Supported agents: ${agentKeys}. You can pass custom arguments like --model.`,
            inputSchema: {
              type: "object",
              properties: {
                agent: { 
                  type: "string", 
                  description: "The preconfigured agent to connect to.",
                  enum: Object.keys(PRECONFIGURED_AGENTS) 
                },
                connectionId: { 
                  type: "string", 
                  description: "A unique identifier for this connection (e.g., 'task-1')." 
                },
                cwd: { 
                  type: "string", 
                  description: "Working directory for the agent. Overrides the default agent directory." 
                },
                extraArgs: {
                  type: "array",
                  items: { type: "string" },
                  description: "Extra arguments to pass to the agent command (e.g., ['--model', 'gemini-2.0-flash'])."
                },
                env: { 
                  type: "object", 
                  additionalProperties: { type: "string" },
                  description: "Environment variables for the agent process."
                },
                authMethodId: { 
                  type: "string", 
                  description: "Optional authentication method ID." 
                },
              },
              required: ["agent", "connectionId"],
            },
          },
          {
            name: "send_prompt",
            description: "Send a prompt to a specific connected agent. Generation starts in the background unless 'wait' is true.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection to send the prompt to." 
                },
                prompt: { 
                  type: "string", 
                  description: "The message text to send." 
                },
                wait: { 
                  type: "boolean", 
                  description: "If true, blocks until the agent finishes generating the full response." 
                },
              },
              required: ["connectionId", "prompt"],
            },
          },
          {
            name: "read_response",
            description: "Read the current buffered response from a specific agent. This returns instantly even if the agent is still working.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection to read from." 
                },
                wait: { 
                  type: "boolean", 
                  description: "If true, waits until any active generation completes before returning." 
                },
              },
              required: ["connectionId"],
            },
          },
          {
            name: "list_connections",
            description: "List all active ACP agent connections and their current status.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "close_connection",
            description: "Close an active ACP connection and terminate the underlying process.",
            inputSchema: {
              type: "object",
              properties: { 
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection to terminate." 
                } 
              },
              required: ["connectionId"],
            },
          },
        ],
      };
    });

    // 2. Prompt Handlers (Standard MCP)
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: "summarize_session",
            description: "A standard prompt to ask the agent for a conversation summary.",
          }
        ]
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === "summarize_session") {
        return {
          description: "Summarize the current session",
          messages: [
            {
              role: "user",
              content: { type: "text", text: "Please summarize our conversation so far." }
            }
          ]
        };
      }
      throw new Error("Prompt not found");
    });

    // 3. Resource Handlers (Standard MCP)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return { resources: [] };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async () => {
      throw new Error("Resource not found");
    });

    // 4. Tool Call Execution Logic
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "initialize_client") {
          const { agent, connectionId, cwd, extraArgs = [], env, authMethodId } = args as any;
          const config = PRECONFIGURED_AGENTS[agent];
          if (!config) throw new Error(`Agent '${agent}' not found. Available: ${Object.keys(PRECONFIGURED_AGENTS).join(", ")}`);

          if (!checkBinaryExists(config.command)) {
            throw new Error(
              `Binary '${config.command}' for agent '${agent}' not found in PATH.\n` +
              `To install it, run: ${config.installInstructions}`
            );
          }

          const finalCwd = cwd || config.defaultCwd || process.cwd();
          
          const existing = this.connections.get(connectionId);
          if (existing) {
            existing.childProcess.kill();
            this.connections.delete(connectionId);
          }
          
          const combinedArgs = [...config.args, ...extraArgs];
          const spawnEnv = { ...process.env, ...(env || {}) };

          const childProcess = spawn(config.command, combinedArgs, {
            cwd: finalCwd,
            env: spawnEnv,
            stdio: ["pipe", "pipe", "inherit"],
          });

          const webStdout = Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>;
          const webStdin = Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>;
          const clientHandler = new ACPClientHandler();
          const connection = new ClientSideConnection((_) => clientHandler.getClientImpl(), ndJsonStream(webStdin, webStdout));

          await connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: { name: "mcp-acp-bridge", version: "1.1.8" }
          });

          if (authMethodId) await connection.authenticate({ methodId: authMethodId });
          const sessionResponse = await connection.newSession({ cwd: finalCwd, mcpServers: [] });

          this.connections.set(connectionId, {
            connectionId, agentName: agent, cwd: finalCwd, childProcess, connection,
            sessionId: sessionResponse.sessionId, clientHandler, isGenerating: false,
            currentError: null, generatePromise: null,
          });

          return { 
            content: [{ 
              type: "text", 
              text: `Client '${connectionId}' initialized successfully for ${agent}.\nCommand: ${config.command} ${combinedArgs.join(" ")}` 
            }] 
          };
        }

        if (name === "send_prompt") {
          const { connectionId, prompt, wait = false } = args as any;
          const state = this.connections.get(connectionId);
          if (!state) throw new Error(`Connection '${connectionId}' not found.`);
          if (state.isGenerating) throw new Error(`Agent is currently generating. Wait for it to finish.`);

          state.clientHandler.resetBuffer();
          state.isGenerating = true;
          state.currentError = null;
          state.generatePromise = (async () => {
            try {
              await state.connection.prompt({ sessionId: state.sessionId, prompt: [{ type: "text", text: prompt }] });
            } catch (err: any) {
              state.currentError = err.message || String(err);
            } finally {
              state.isGenerating = false;
            }
          })();

          if (wait) {
            await state.generatePromise;
            return { 
              content: [{ 
                type: "text", 
                text: this.formatResponse(state)
              }] 
            };
          }
          return { content: [{ type: "text", text: `Prompt sent to '${connectionId}'. Generation started.` }] };
        }

        if (name === "read_response") {
          const { connectionId, wait = false } = args as any;
          const state = this.connections.get(connectionId);
          if (!state) throw new Error(`Connection '${connectionId}' not found.`);
          
          if (wait && state.generatePromise) await state.generatePromise;
          
          return { content: [{ type: "text", text: this.formatResponse(state) }] };
        }

        if (name === "list_connections") {
          if (this.connections.size === 0) return { content: [{ type: "text", text: "No active connections." }] };
          const lines = Array.from(this.connections.values()).map(s => `- ${s.connectionId} (${s.agentName}): ${s.isGenerating ? "Generating" : "Idle"} | CWD: ${s.cwd}`);
          return { content: [{ type: "text", text: `Active Connections:\n${lines.join("\n")}` }] };
        }

        if (name === "close_connection") {
          const { connectionId } = args as any;
          const state = this.connections.get(connectionId);
          if (!state) throw new Error(`Connection '${connectionId}' not found.`);
          state.childProcess.kill();
          this.connections.delete(connectionId);
          return { content: [{ type: "text", text: `Connection '${connectionId}' closed and process terminated.` }] };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: err.message || String(err) }] };
      }
    });
  }

  private formatResponse(state: ACPConnectionState): string {
    const status = state.isGenerating ? "generating" : (state.currentError ? "error" : "complete");
    
    let text = `Status: ${status}\n`;
    
    if (state.clientHandler.toolLogs.length > 0) {
      text += `\nActivity Log:\n${state.clientHandler.toolLogs.map(l => "  " + l).join("\n")}\n`;
    }
    
    text += `\nResponse Buffer:\n${state.clientHandler.responseBuffer || "(empty)"}`;
    
    if (state.currentError) {
      text += `\n\nError: ${state.currentError}`;
    }
    
    return text;
  }

  private setupCleanup() {
    const cleanup = () => {
      for (const state of this.connections.values()) state.childProcess.kill();
      this.connections.clear();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
