import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess, execSync } from "child_process";
import { Readable, Writable } from "stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, SessionId } from "@agentclientprotocol/sdk";
import { PRECONFIGURED_AGENTS } from "./config.js";
import { ACPClientHandler, ToolApprovalMode } from "./client.js";

function checkBinaryExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const INIT_TIMEOUT_MS = 30000;

function debugLog(message: string, data?: any) {
  if (process.env.BRIDGE_DEBUG === "true") {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] DEBUG: ${message}`;
    if (data) {
      console.error(`${logMessage} ${JSON.stringify(data, null, 2)}`);
    } else {
      console.error(logMessage);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
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
  toolApprovalMode: ToolApprovalMode;
  createdAt: number;
  processExited: boolean;
}

export class ACPServer {
  public server: Server;
  private connections = new Map<string, ACPConnectionState>();

  constructor() {
    this.server = new Server(
      {
        name: "mcp-acp-bridge",
        version: "1.2.2",
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
      const agentKeys = Object.keys(PRECONFIGURED_AGENTS).join(", ");
      return {
        tools: [
          {
            name: "initialize_client",
            description: `Initialize a new ACP agent connection. Supported agents: ${agentKeys}. You can pass custom arguments like --model. Set toolApprovalMode to "manual" to hold tool call permissions for explicit approval via approve_tool_call.`,
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
                toolApprovalMode: {
                  type: "string",
                  enum: ["auto", "manual"],
                  description: 'Tool approval mode. "auto" (default) approves all tool calls automatically. "manual" holds permission requests for explicit approval via approve_tool_call.'
                },
              },
              required: ["agent", "connectionId"],
            },
          },
          {
            name: "send_prompt",
            description: "Send a prompt to a specific connected agent. Use preserveHistory=true for multi-turn conversations without losing prior response context.",
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
                mode: { 
                  type: "string", 
                  description: "Wait: block until finished. Poll: start and return immediately. Interrupt: stop current generation and send new prompt.",
                  enum: ["wait", "poll", "interrupt"] 
                },
                preserveHistory: {
                  type: "boolean",
                  description: "If true, append to existing response buffer instead of clearing it. Use for multi-turn conversations where you need prior context. Default: false."
                },
              },
              required: ["connectionId", "prompt"],
            },
          },
          {
            name: "read_response",
            description: "Read the response from a specific agent. Supports incremental reads (only new content since last read) and detailed tool call information.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection to read from." 
                },
                mode: { 
                  type: "string", 
                  description: "Wait: block until any active generation completes. Poll: return current snapshot immediately.",
                  enum: ["wait", "poll"] 
                },
                sinceLastRead: {
                  type: "boolean",
                  description: "If true, only return content that has been added since the last read_response call (incremental mode). Default: false (return full buffer)."
                },
                includeToolDetails: {
                  type: "boolean",
                  description: "If true, include detailed tool call information (tool name, status, content) instead of just log summaries. Default: false."
                },
              },
              required: ["connectionId"],
            },
          },
          {
            name: "approve_tool_call",
            description: "Approve or deny a pending tool call permission request from an agent (only applicable when toolApprovalMode is 'manual'). List pending requests first, then approve/deny by requestId.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection." 
                },
                requestId: { 
                  type: "string", 
                  description: "The ID of the pending permission request to approve/deny." 
                },
                action: { 
                  type: "string", 
                  enum: ["approve", "deny"],
                  description: "approve: allow the tool call. deny: cancel the tool call."
                },
                optionIndex: { 
                  type: "integer",
                  description: "When approving, the index of the option to select (default: 0, typically 'allow'). Use list_connections to see available options."
                },
              },
              required: ["connectionId", "requestId", "action"],
            },
          },
          {
            name: "reset_session",
            description: "Reset the agent session on an existing connection. Clears conversation history and response buffers without restarting the agent process. Much faster than closing and re-initializing.",
            inputSchema: {
              type: "object",
              properties: {
                connectionId: { 
                  type: "string", 
                  description: "The ID of the connection to reset." 
                },
                cwd: {
                  type: "string",
                  description: "Optional new working directory for the reset session."
                },
              },
              required: ["connectionId"],
            },
          },
          {
            name: "list_connections",
            description: "List all active ACP agent connections with their status, pending permissions, and tool call summaries.",
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



    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "initialize_client") {
          return await this.handleInitializeClient(args as any);
        }

        if (name === "send_prompt") {
          return await this.handleSendPrompt(args as any);
        }

        if (name === "read_response") {
          return await this.handleReadResponse(args as any);
        }

        if (name === "approve_tool_call") {
          return this.handleApproveToolCall(args as any);
        }

        if (name === "reset_session") {
          return await this.handleResetSession(args as any);
        }

        if (name === "list_connections") {
          return this.handleListConnections();
        }

        if (name === "close_connection") {
          return this.handleCloseConnection(args as any);
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (err: any) {
        return { isError: true, content: [{ type: "text", text: err.message || String(err) }] };
      }
    });
  }

  private async handleInitializeClient(args: {
    agent: string;
    connectionId: string;
    cwd?: string;
    extraArgs?: string[];
    env?: Record<string, string>;
    authMethodId?: string;
    toolApprovalMode?: ToolApprovalMode;
  }) {
    const { agent, connectionId, cwd, extraArgs = [], env, authMethodId, toolApprovalMode = "auto" } = args;
    const config = PRECONFIGURED_AGENTS[agent];
    if (!config) throw new Error(`Agent '${agent}' not found. Available: ${Object.keys(PRECONFIGURED_AGENTS).join(", ")}`);

    if (!checkBinaryExists(config.command)) {
      throw new Error(
        `Binary '${config.command}' for agent '${agent}' not found in PATH.\nTo install it, run: ${config.installInstructions}`
      );
    }

    if (toolApprovalMode === "manual" && config.supportsManualApproval === false) {
      throw new Error(`Agent '${agent}' does not support manual tool approval mode via the ACP protocol.`);
    }

    if (extraArgs.length > 0 && config.unsupportedArgs) {
      const invalidArgs = extraArgs.filter(arg => 
        config.unsupportedArgs?.some(unsupported => arg.startsWith(unsupported))
      );
      if (invalidArgs.length > 0) {
        throw new Error(`Agent '${agent}' does not support the following arguments: ${invalidArgs.join(", ")}`);
      }
    }

    const finalCwd = cwd || config.defaultCwd || process.cwd();

    const existing = this.connections.get(connectionId);
    if (existing) {
      existing.childProcess.kill();
      this.connections.delete(connectionId);
    }

    const combinedArgs = [...config.args, ...extraArgs];
    const spawnEnv = { ...process.env, ...(env || {}) };

    debugLog(`Initializing agent: ${agent}`, { connectionId, command: config.command, combinedArgs, cwd: finalCwd });

    const childProcess = spawn(config.command, combinedArgs, {
      cwd: finalCwd,
      env: spawnEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const clientHandler = new ACPClientHandler();
    clientHandler.toolApprovalMode = toolApprovalMode;

    childProcess.stderr?.on("data", (data) => {
      const str = data.toString();
      clientHandler.handleStderr(str);
      process.stderr.write(`[Agent ${connectionId} Stderr]: ${str}`);
    });

    childProcess.on("error", (err) => {
      debugLog(`Child process spawn error for ${connectionId}:`, err);
    });

    childProcess.on("exit", (code, signal) => {
      debugLog(`Child process exited for ${connectionId}:`, { code, signal });
      const state = this.connections.get(connectionId);
      if (state) {
        state.processExited = true;
        state.isGenerating = false;
        if (state.generatePromise) {
          state.currentError = state.currentError || `Agent process exited with code ${code}, signal ${signal}`;
        }
      }
    });

    try {
      debugLog(`Starting ACP handshake for ${connectionId}...`);
      const webStdout = Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>;
      const webStdin = Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>;
      const connection = new ClientSideConnection((_) => clientHandler.getClientImpl(), ndJsonStream(webStdin, webStdout));

      const initializeAndCreateSession = async () => {
        debugLog(`Connecting to ACP protocol version ${PROTOCOL_VERSION}...`);
        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "mcp-acp-bridge", version: "1.2.2" }
        });

        if (authMethodId) {
          debugLog(`Authenticating with method: ${authMethodId}`);
          await connection.authenticate({ methodId: authMethodId });
        }

        debugLog(`Creating new ACP session for ${connectionId}...`);
        return await connection.newSession({ cwd: finalCwd, mcpServers: [] });
      };

      const sessionResponse = await withTimeout(initializeAndCreateSession(), INIT_TIMEOUT_MS);
      debugLog(`ACP Session created successfully for ${connectionId}:`, { sessionId: sessionResponse.sessionId });

      this.connections.set(connectionId, {
        connectionId, agentName: agent, cwd: finalCwd, childProcess, connection,
        sessionId: sessionResponse.sessionId, clientHandler, isGenerating: false,
        currentError: null, generatePromise: null, toolApprovalMode,
        createdAt: Date.now(), processExited: false,
      });

      return { 
        content: [
          { type: "text", text: `Client '${connectionId}' initialized successfully for ${agent}.` },
          { type: "text", text: `Command: ${config.command} ${combinedArgs.join(" ")}` },
          { type: "text", text: `Tool Approval: ${toolApprovalMode}` },
        ] 
      };
    } catch (error: any) {
      const agentLogs = clientHandler.errorBuffer ? `\nAgent Logs:\n${clientHandler.errorBuffer}` : "";
      debugLog(`Initialization failed for ${connectionId}, killing process.`, { error: error.message });
      childProcess.kill("SIGKILL");
      throw new Error(`Failed to initialize agent '${agent}': ${error.message}${agentLogs}`);
    }
  }

  private async handleSendPrompt(args: {
    connectionId: string;
    prompt: string;
    mode?: "wait" | "poll" | "interrupt";
    preserveHistory?: boolean;
  }) {
    const { connectionId, prompt, mode = "poll", preserveHistory = false } = args;
    const state = this.connections.get(connectionId);
    if (!state) throw new Error(`Connection '${connectionId}' not found.`);

    if (state.processExited) throw new Error(`Agent process for '${connectionId}' has exited. Use reset_session or close and re-initialize.`);

    debugLog(`Sending prompt to ${connectionId} (mode=${mode})`, { promptLength: prompt.length });

    if (state.isGenerating && mode !== "interrupt") {
      throw new Error(`Agent is currently generating. Use mode='interrupt' to append anyway, or mode='wait' in read_response to wait.`);
    }

    if (mode === "interrupt") {
      debugLog(`Interrupting/Appending to active generation for ${connectionId}`);
    } else {
      if (!preserveHistory) {
        state.clientHandler.resetBuffer();
      }
    }

    state.isGenerating = true;
    state.currentError = null;

    const runPrompt = async () => {
      try {
        await state.connection.prompt({ sessionId: state.sessionId, prompt: [{ type: "text", text: prompt }] });
      } catch (err: any) {
        state.currentError = err.message || String(err);
      } finally {
        state.isGenerating = false;
      }
    };

    if (mode === "interrupt") {
      runPrompt();
      return { 
        content: [
          { type: "text", text: `Message appended to '${connectionId}' session. Generation continuing/restarted.` },
          ...this.formatResponse(state, { sinceLastRead: false, includeToolDetails: false })
        ] 
      };
    }

    state.generatePromise = runPrompt();

    if (mode === "wait") {
      await state.generatePromise;
      return { content: this.formatResponse(state, { sinceLastRead: false, includeToolDetails: false }) };
    }

    return { 
      content: [
        { type: "text", text: `Prompt sent to '${connectionId}'. Generation started.` },
        ...this.formatResponse(state, { sinceLastRead: false, includeToolDetails: false })
      ] 
    };
  }

  private async handleReadResponse(args: {
    connectionId: string;
    mode?: "wait" | "poll";
    sinceLastRead?: boolean;
    includeToolDetails?: boolean;
  }) {
    const { connectionId, mode = "poll", sinceLastRead = false, includeToolDetails = false } = args;
    const state = this.connections.get(connectionId);
    if (!state) throw new Error(`Connection '${connectionId}' not found.`);

    if (mode === "wait" && state.generatePromise) {
      await state.generatePromise;
    }

    const result = this.formatResponse(state, { sinceLastRead, includeToolDetails });

    if (sinceLastRead) {
      state.clientHandler.lastReadOffset = state.clientHandler.responseChunks.length;
    }

    return { content: result };
  }

  private handleApproveToolCall(args: {
    connectionId: string;
    requestId: string;
    action: "approve" | "deny";
    optionIndex?: number;
  }) {
    const { connectionId, requestId, action, optionIndex = 0 } = args;
    const state = this.connections.get(connectionId);
    if (!state) throw new Error(`Connection '${connectionId}' not found.`);

    if (state.toolApprovalMode === "auto") {
      return { content: [{ type: "text", text: `Connection '${connectionId}' is in 'auto' approval mode. No manual approval needed.` }] };
    }

    if (action === "deny") {
      const denied = state.clientHandler.denyPermission(requestId);
      if (!denied) {
        throw new Error(`Permission request '${requestId}' not found. It may have already been resolved or expired.`);
      }
      return { content: [{ type: "text", text: `Permission request '${requestId}' denied.` }] };
    }

    const approved = state.clientHandler.approvePermission(requestId, optionIndex);
    if (!approved) {
      throw new Error(`Permission request '${requestId}' not found. It may have already been resolved or expired.`);
    }
    return { content: [{ type: "text", text: `Permission request '${requestId}' approved (option index: ${optionIndex}).` }] };
  }

  private async handleResetSession(args: {
    connectionId: string;
    cwd?: string;
  }) {
    const { connectionId, cwd } = args;
    const state = this.connections.get(connectionId);
    if (!state) throw new Error(`Connection '${connectionId}' not found.`);

    if (state.processExited) throw new Error(`Agent process for '${connectionId}' has exited. Cannot reset session. Use close_connection then initialize_client.`);

    debugLog(`Resetting session for ${connectionId}`);

    try {
      const sessionCwd = cwd || state.cwd;

      if (state.isGenerating && state.generatePromise) {
        try {
          await state.connection.cancel({ sessionId: state.sessionId });
        } catch {
          debugLog(`Cancel failed during reset for ${connectionId}, proceeding anyway`);
        }
      }

      const sessionResponse = await withTimeout(
        state.connection.newSession({ cwd: sessionCwd, mcpServers: [] }),
        INIT_TIMEOUT_MS
      );

      state.sessionId = sessionResponse.sessionId;
      state.cwd = sessionCwd;
      state.clientHandler.resetForNewSession();
      state.isGenerating = false;
      state.currentError = null;
      state.generatePromise = null;

      return {
        content: [
          { type: "text", text: `Session reset successfully for '${connectionId}'. New session ID: ${sessionResponse.sessionId}` },
          { type: "text", text: `CWD: ${sessionCwd}` },
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to reset session for '${connectionId}': ${error.message}`);
    }
  }

  private handleListConnections() {
    if (this.connections.size === 0) return { content: [{ type: "text", text: "No active connections." }] };
    const content: { type: "text"; text: string }[] = [{ type: "text", text: "Active Connections:" }];
    for (const s of this.connections.values()) {
      const status = s.processExited ? "Exited" : (s.isGenerating ? "Generating" : "Idle");
      const pendingCount = s.clientHandler.pendingPermissions.size;
      const toolCallCount = s.clientHandler.toolCallDetails.size;
      content.push({
        type: "text",
        text: [
          `- ${s.connectionId} (${s.agentName}): ${status}`,
          `  CWD: ${s.cwd}`,
          `  Approval Mode: ${s.toolApprovalMode}`,
          `  Pending Permissions: ${pendingCount}`,
          `  Tool Calls (total): ${toolCallCount}`,
          `  Process: ${s.processExited ? "exited" : "running"}`,
          `  Age: ${Math.round((Date.now() - s.createdAt) / 1000)}s`,
        ].join("\n")
      });
    }
    return { content };
  }

  private handleCloseConnection(args: { connectionId: string }) {
    const { connectionId } = args;
    const state = this.connections.get(connectionId);
    if (!state) throw new Error(`Connection '${connectionId}' not found.`);
    state.childProcess.kill();
    this.connections.delete(connectionId);
    return { content: [{ type: "text", text: `Connection '${connectionId}' closed and process terminated.` }] };
  }

  private formatResponse(
    state: ACPConnectionState,
    options: { sinceLastRead: boolean; includeToolDetails: boolean } = { sinceLastRead: false, includeToolDetails: false }
  ): { type: "text"; text: string }[] {
    const status = state.processExited
      ? "process_exited"
      : (state.isGenerating ? "generating" : (state.currentError ? "error" : "complete"));

    const content: { type: "text"; text: string }[] = [
      { type: "text", text: `Status: ${status}` }
    ];

    const pendingPermissions = Array.from(state.clientHandler.pendingPermissions.values());
    if (pendingPermissions.length > 0) {
      content.push({ type: "text", text: "" });
      content.push({ type: "text", text: "Pending Approvals:" });
      for (const perm of pendingPermissions) {
        content.push({
          type: "text",
          text: `  [${perm.requestId}] ${perm.description} (options: ${perm.options.map(o => `${o.kind}:${o.optionId}`).join(", ")})`
        });
      }
    }

    const chunks = options.sinceLastRead
      ? state.clientHandler.responseChunks.slice(state.clientHandler.lastReadOffset)
      : state.clientHandler.responseChunks;

    if (state.clientHandler.toolLogs.length > 0 && !options.includeToolDetails) {
      content.push({ type: "text", text: "" });
      content.push({ type: "text", text: "Activity Log:" });
      state.clientHandler.toolLogs.forEach(l => {
        content.push({ type: "text", text: `  ${l}` });
      });
    }

    if (options.includeToolDetails && state.clientHandler.toolCallDetails.size > 0) {
      content.push({ type: "text", text: "" });
      content.push({ type: "text", text: "Tool Call Details:" });
      for (const [toolCallId, detail] of state.clientHandler.toolCallDetails) {
        const duration = detail.completedAt
          ? `${((detail.completedAt - detail.startedAt) / 1000).toFixed(1)}s`
          : `running for ${((Date.now() - detail.startedAt) / 1000).toFixed(1)}s`;
        content.push({
          type: "text",
          text: `  [${toolCallId}] ${detail.toolName} - ${detail.status} (${duration})`
        });
        if (detail.content.length > 0) {
          detail.content.forEach(c => {
            content.push({ type: "text", text: `    ${c}` });
          });
        }
      }
    }

    content.push({ type: "text", text: "" });
    content.push({ type: "text", text: options.sinceLastRead ? "New Response Content:" : "Response Content:" });

    if (chunks.length === 0) {
      content.push({ type: "text", text: "(empty)" });
    } else {
      chunks.forEach(chunk => {
        if (chunk.type === "log") {
          content.push({ type: "text", text: "" });
          content.push({ type: "text", text: chunk.text });
          content.push({ type: "text", text: "" });
        } else {
          content.push({ type: "text", text: chunk.text });
        }
      });
    }

    if (state.currentError || state.clientHandler.errorBuffer) {
      content.push({ type: "text", text: "" });
      const errorMsg = state.currentError ? `Error: ${state.currentError}` : "Agent Error Logs:";
      content.push({ type: "text", text: errorMsg });
      if (state.clientHandler.errorBuffer) {
        content.push({ type: "text", text: state.clientHandler.errorBuffer });
      }
    }

    if (options.sinceLastRead) {
      content.push({
        type: "text",
        text: `(Showing ${chunks.length} new chunks since last read. Total buffer: ${state.clientHandler.responseChunks.length})`
      });
    }

    return content;
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