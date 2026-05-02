# ACP Gemini MCP Server

A Model Context Protocol (MCP) server that provides a bridge to interact with any Agent Client Protocol (ACP) compatible agent (like Gemini CLI, Claude Code, etc.) through a stateful tool-based interface.

## Features

- **Stateful Sessions**: Maintains a persistent connection and conversation history with the underlying ACP agent.
- **Background Generation**: Supports asynchronous prompt processing, allowing you to send a prompt and continue work while the agent generates a response.
- **Flexible Tooling**: Provides tools to initialize the client, send prompts (with optional blocking), and read responses.
- **Native SDK Integration**: Built using the official `@agentclientprotocol/sdk` and `@modelcontextprotocol/sdk`.

## Installation

Ensure you have [Bun](https://bun.sh/) installed.

```bash
bun install
```

## Usage

### Running the Server

The server runs over standard input/output (stdio), making it compatible with any MCP client.

```bash
bun run index.ts
```

### MCP Tools

#### 1. `initialize_client`
Initializes the ACP client to connect to an external agent command.

**Parameters:**
- `command` (string, required): The ACP agent command (e.g., `gemini`, `claude-code-acp`).
- `args` (string[]): Arguments to pass to the agent command (e.g., `["--acp"]`).
- `cwd` (string): Working directory for the agent.
- `env` (object): Environment variables for the agent.
- `authMethodId` (string): Auth method ID (e.g., `oauth-personal`).

#### 2. `send_prompt`
Sends a prompt to the connected agent.

**Parameters:**
- `prompt` (string, required): The message to send to the agent.
- `wait` (boolean): If `true`, the tool blocks until the full response is generated and returns the text. If `false` (default), it starts generation in the background and returns immediately.

#### 3. `read_response`
Reads the current response buffer from the agent.

**Parameters:**
- `wait` (boolean): If `true`, waits until the full response is generated before returning. If `false` (default), returns immediately with the current buffer.

## Configuration for Gemini CLI

To use this MCP server in your local project with the Gemini CLI, add the following to your `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "acp-gemini": {
      "command": "bun",
      "args": ["run", "/path/to/your/project/index.ts"]
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
