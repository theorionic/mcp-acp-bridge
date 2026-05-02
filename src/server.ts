import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, SessionId } from "@agentclientprotocol/sdk";
import { PRECONFIGURED_AGENTS } from "./config.js";
import { ACPClientHandler } from "./client.js";

export class ACPServer {
  public server: Server;
  
  private childProcess: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private currentSessionId: SessionId | null = null;
  
  private clientHandler: ACPClientHandler;
  private isGenerating = false;
  private currentError: string | null = null;
  private generatePromise: Promise<void> | null = null;

  constructor() {
    this.clientHandler = new ACPClientHandler();
    this.server = new Server(
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
            description: "Initialize the ACP client using a preconfigured agent.",
            inputSchema: {
              type: "object",
              properties: {
                agent: {
                  type: "string",
                  description: `The preconfigured agent to connect to (e.g., ${agentKeys}).`,
                  enum: Object.keys(PRECONFIGURED_AGENTS)
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
              required: ["agent"],
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "initialize_client") {
          const { agent, cwd = process.cwd(), env, authMethodId } = args as any;

          const config = PRECONFIGURED_AGENTS[agent];
          if (!config) {
             throw new Error(`Agent '${agent}' is not preconfigured. Available agents: ${Object.keys(PRECONFIGURED_AGENTS).join(", ")}`);
          }

          if (this.childProcess) {
            this.childProcess.kill();
            this.childProcess = null;
          }
          
          const spawnEnv = { ...process.env, ...(env || {}) };

          this.childProcess = spawn(config.command, config.args, {
            cwd,
            env: spawnEnv,
            stdio: ["pipe", "pipe", "inherit"],
          });

          const webStdout = Readable.toWeb(this.childProcess.stdout!) as ReadableStream<Uint8Array>;
          const webStdin = Writable.toWeb(this.childProcess.stdin!) as WritableStream<Uint8Array>;

          const stream = ndJsonStream(webStdin, webStdout);

          this.connection = new ClientSideConnection((_) => this.clientHandler.getClientImpl(), stream);

          await this.connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: { name: "acp-mcp-server", version: "1.0.0" }
          });

          if (authMethodId) {
            await this.connection.authenticate({ methodId: authMethodId });
          }

          const sessionResponse = await this.connection.newSession({
            cwd,
            mcpServers: []
          });

          this.currentSessionId = sessionResponse.sessionId;
          this.clientHandler.resetBuffer();
          this.isGenerating = false;
          this.generatePromise = null;
          this.currentError = null;

          return {
            content: [{ type: "text", text: `Client initialized successfully for agent: ${agent} (Command: ${config.command} ${config.args.join(" ")})` }],
          };
        }

        if (name === "send_prompt") {
          if (!this.connection || !this.currentSessionId) {
            throw new Error("Client not initialized. Call initialize_client first.");
          }

          if (this.isGenerating) {
            throw new Error("A generation is already in progress. Wait for it to finish before sending a new prompt.");
          }

          const { prompt, wait = false } = args as any;
          this.clientHandler.resetBuffer();
          this.isGenerating = true;
          this.currentError = null;

          // Start the stream asynchronously
          this.generatePromise = (async () => {
            try {
              await this.connection!.prompt({
                sessionId: this.currentSessionId!,
                prompt: [{ type: "text", text: prompt }]
              });
            } catch (err: any) {
              this.currentError = err.message || String(err);
            } finally {
              this.isGenerating = false;
            }
          })();

          if (wait) {
            await this.generatePromise;
            const status = this.currentError ? "error" : "complete";
            let text = `Status: ${status}\n\nResponse:\n${this.clientHandler.responseBuffer}`;
            if (this.currentError) {
              text += `\n\nError: ${this.currentError}`;
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

          if (wait && this.generatePromise) {
            await this.generatePromise;
          }

          const status = this.isGenerating ? "generating" : (this.currentError ? "error" : "complete");
          let text = `Status: ${status}\n\nResponse:\n${this.clientHandler.responseBuffer}`;

          if (this.currentError) {
            text += `\n\nError: ${this.currentError}`;
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
  }

  private setupCleanup() {
    process.on("SIGINT", () => {
      if (this.childProcess) this.childProcess.kill();
      process.exit(0);
    });
  }
}
