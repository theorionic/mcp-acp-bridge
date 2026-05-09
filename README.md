# mcp-acp-bridge

A Model Context Protocol (MCP) server that provides a bridge to interact with any Agent Client Protocol (ACP) compatible agent (like Gemini CLI, Claude Code, OpenCode, Codex, Pi, Aider, etc.) through a stateful tool-based interface.

## Features

- **Multi-Agent Support**: Connect to and manage multiple ACP agents concurrently using unique connection IDs.
- **Flexible Directories**: Each agent connection can operate in a different working directory, perfect for multi-tasking across projects.
- **Background Generation**: Supports asynchronous prompt processing, allowing you to send prompts to multiple agents and read their responses as they become available.
- **Tool Approval Control**: Manual or automatic approval of agent tool calls. In manual mode, tool calls are held until explicitly approved or denied.
- **Incremental Response Reading**: Read only new content since the last read, enabling efficient streaming for long-running tasks.
- **Tool Call Details**: Inspect detailed tool call information — which tools were called, their status, duration, and output.
- **Session Reset**: Reset an agent's conversation context without restarting the process, for clean multi-task sessions.
- **Process Health Tracking**: Detect when an agent process exits and surface this to the orchestrator.
- **Native SDK Integration**: Built using the official `@agentclientprotocol/sdk` and `@modelcontextprotocol/sdk`.

## Installation

### From NPM (Global)

```bash
npm install -g @theorionic/mcp-acp-bridge
```

### From Source

The project prefers [Bun](https://bun.sh/) but will fall back to NPM/Node if Bun is not present.

```bash
# If you have Bun
bun install
bun run build

# Or using NPM
npm install
npm run build
```

## Supported Agents & Configuration

The bridge comes preconfigured with several popular AI agents. Below is a guide on how to add this MCP server to different environments and the required setup for each agent.

### 1. General MCP Configuration

To use this bridge in your IDE (like Zed, Cursor, or VS Code with an MCP extension), add it to your configuration file:

```json
{
  "mcpServers": {
    "acp-bridge": {
      "command": "npx",
      "args": ["-y", "@theorionic/mcp-acp-bridge"]
    }
  }
}
```

### 2. Preconfigured Agent Details

When calling `initialize_client`, use the following `agent` keys:

| Agent Key | Command Used | Requirements / Setup |
|-----------|--------------|----------------------|
| `gemini` | `gemini --acp` | Install Gemini CLI: `npm install -g @google/gemini-cli` |
| `opencode` | `opencode acp` | Install OpenCode: `npm install -g opencode-ai` |

### 3. Adding to Specific AI Agents

#### Gemini CLI
Add to `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "acp-bridge": {
      "command": "npx",
      "args": ["-y", "@theorionic/mcp-acp-bridge"]
    }
  }
}
```

#### Claude (Desktop/Web)
Currently, custom MCP servers are primarily supported in the Claude Desktop app. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "acp-bridge": {
      "command": "npx",
      "args": ["-y", "@theorionic/mcp-acp-bridge"]
    }
  }
}
```

#### Zed Editor
Add to `~/.config/zed/settings.json`:
```json
{
  "context_servers": [
    {
      "name": "acp-bridge",
      "command": "npx",
      "args": ["-y", "@theorionic/mcp-acp-bridge"]
    }
  ]
}
```

## Usage

### Running the Server

If installed globally via NPM:

```bash
mcp-acp-bridge
```

From source (automatically detects Bun or Node):

```bash
npm start
```

### MCP Tools

#### 1. `initialize_client`
Initializes a new ACP connection using a preconfigured agent.

**Parameters:**
- `agent` (string, required): The preconfigured agent to connect to (e.g., `gemini`, `opencode`).
- `connectionId` (string, required): A unique identifier you choose for this connection (e.g., `"frontend-dev"`, `"docs-agent"`).
- `cwd` (string): Working directory for this specific agent.
- `env` (object): Environment variables for the agent process.
- `authMethodId` (string): Auth method ID (e.g., `oauth-personal`).
- `extraArgs` (array of strings): Additional CLI arguments (e.g., `["--model", "gemini-2.0-flash"]`).
- `toolApprovalMode` (string: `"auto"` | `"manual"`): Controls how tool call permissions are handled. Default: `"auto"`.
  - `"auto"`: All tool calls are automatically approved (original behavior).
  - `"manual"`: Tool calls are held until explicitly approved or denied via `approve_tool_call`.

#### 2. `send_prompt`
Sends a prompt to a specific connected agent.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to use.
- `prompt` (string, required): The message to send to the agent.
- `mode` (string: `"wait"` | `"poll"` | `"interrupt"`): How to handle the prompt.
  - `wait`: Block until the full response is generated.
  - `poll`: Start generation and return immediately.
  - `interrupt`: Stop current generation and send a new prompt.
- `preserveHistory` (boolean): If `true`, append to the existing response buffer instead of clearing it. Useful for multi-turn conversations where you need prior context. Default: `false`.

#### 3. `read_response`
Reads the response from a specific agent. Supports incremental reads and detailed tool call information.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to read from.
- `mode` (string: `"wait"` | `"poll"`): `wait` blocks until generation completes, `poll` returns immediately.
- `sinceLastRead` (boolean): If `true`, only returns content added since the last `read_response` call (incremental mode). Useful for monitoring long-running tasks without re-reading the full buffer. Default: `false`.
- `includeToolDetails` (boolean): If `true`, includes detailed tool call information (tool name, status, duration, content) instead of just activity log summaries. Default: `false`.

#### 4. `approve_tool_call`
Approve or deny a pending tool call permission request from an agent. Only applicable when the connection's `toolApprovalMode` is `"manual"`.

**Parameters:**
- `connectionId` (string, required): The ID of the connection.
- `requestId` (string, required): The ID of the pending permission request (visible in `read_response` or `list_connections` output).
- `action` (string: `"approve"` | `"deny"`): Whether to approve or deny the permission request.
- `optionIndex` (integer): When approving, which option to select (default: `0`, typically "allow"). Use `list_connections` to see available options.

#### 5. `reset_session`
Reset the agent's conversation session on an existing connection. Clears conversation history and response buffers without restarting the agent process. Much faster than closing and re-initializing.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to reset.
- `cwd` (string): Optional new working directory for the reset session.

#### 6. `list_connections`
Lists all active ACP connections with detailed status information including pending permission requests, tool call counts, and process health.

#### 7. `close_connection`
Closes a specific ACP connection and terminates the underlying agent process.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to close.

### Orchestration Pattern Example

Here's a typical pattern for orchestrating a coding agent:

```
1. initialize_client(agent="gemini", connectionId="coder", toolApprovalMode="manual")
2. send_prompt(connectionId="coder", prompt="Implement the auth module")
3. read_response(connectionId="coder", mode="poll", includeToolDetails=true)
   → See pending tool calls, approve/deny as needed
4. approve_tool_call(connectionId="coder", requestId="perm_123", action="approve")
5. read_response(connectionId="coder", mode="wait", sinceLastRead=true, includeToolDetails=true)
   → Get only new content, with tool call details
6. reset_session(connectionId="coder")
   → Clean slate for next task, no process restart needed
7. send_prompt(connectionId="coder", prompt="Now implement the tests")
...
8. close_connection(connectionId="coder")
```

## Configuration for Gemini CLI

To use this MCP server in your local project with the Gemini CLI, add the following to your `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "acp-gemini": {
      "command": "bun",
      "args": ["run", "/path/to/your/project/src/index.ts"]
    }
  }
}
```

## Development

This project uses:
- `@modelcontextprotocol/sdk` for MCP server implementation.
- `@agentclientprotocol/sdk` for ACP client communication.
- `child_process.spawn` to manage the underlying agent process.

## License

Apache-2.0