# mcp-acp-bridge

A Model Context Protocol (MCP) server that provides a bridge to interact with any Agent Client Protocol (ACP) compatible agent (like Gemini CLI, Claude Code, OpenCode, Codex, Pi, Aider, etc.) through a stateful tool-based interface.

## Features

- **Multi-Agent Support**: Connect to and manage multiple ACP agents concurrently using unique connection IDs.
- **Flexible Directories**: Each agent connection can operate in a different working directory, perfect for multi-tasking across projects.
- **Background Generation**: Supports asynchronous prompt processing, allowing you to send prompts to multiple agents and read their responses as they become available.
- **Flexible Tooling**: Tools to initialize, list, switch between, and close agent connections.
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
- `agent` (string, required): The preconfigured agent to connect to (e.g., `gemini`, `claude-code`).
- `connectionId` (string, required): A unique identifier you choose for this connection (e.g., `"frontend-dev"`, `"docs-agent"`).
- `cwd` (string): Working directory for this specific agent.
- `env` (object): Environment variables for the agent.
- `authMethodId` (string): Auth method ID (e.g., `oauth-personal`).

#### 2. `send_prompt`
Sends a prompt to a specific connected agent.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to use.
- `prompt` (string, required): The message to send to the agent.
- `wait` (boolean): If `true`, the tool blocks until the full response is generated and returns the text.

#### 3. `read_response`
Reads the current response buffer from a specific agent.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to read from.
- `wait` (boolean): If `true`, waits until the full response is generated before returning.

#### 4. `list_connections`
Lists all active ACP connections, their status (Idle/Generating/Error), and their working directories.

#### 5. `close_connection`
Closes a specific ACP connection and terminates the underlying agent process.

**Parameters:**
- `connectionId` (string, required): The ID of the connection to close.

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
