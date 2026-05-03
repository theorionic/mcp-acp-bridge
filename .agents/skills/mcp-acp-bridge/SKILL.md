---
name: mcp-acp-bridge
description: Orchestrate multiple ACP agents (Gemini, Claude, etc.) using a stateful tool-based bridge. Use when you need to manage background generations, run agents in different directories, or track real-time tool logs across multiple connections.
---

# MCP-ACP Bridge Guide

This skill provides instructions for using the `mcp-acp-bridge` server to interact with Agent Client Protocol (ACP) agents.

## Core Tools

### 1. Connection Management
Initialize and manage your agent instances.

- **`initialize_client`**: Connect to a preconfigured agent.
  - `agent`: Choose from `gemini`, `claude-code`, etc. See [agents.md](references/agents.md) for the full list.
  - `connectionId`: Assign a unique name to this session.
  - `cwd`: (Optional) Set the agent's working directory.
  - `extraArgs`: (Optional) Pass flags like `["--model", "gemini-2.0-flash"]`.

- **`list_connections`**: See all active agents, their directories, and whether they are `Idle` or `Generating`.
- **`close_connection`**: Terminate an agent and clean up its state.

### 2. Prompting and Responses
Interact with your agents asynchronously.

- **`send_prompt`**: Send a message to an agent.
  - `wait: false` (Default): Dispatches the prompt and returns immediately. Recommended for long tasks to avoid client timeouts.
  - `wait: true`: Blocks until the full response is ready.

- **`read_response`**: Fetch the current output.
  - Returns the **Activity Log** (real-time list of tool calls the agent has made).
  - Returns the **Response Buffer** (the text generated so far).
  - Use `wait: true` to block until completion.

## Advanced Usage

- **Parallel Workflows**: Task multiple agents simultaneously. See [workflow-patterns.md](references/workflow-patterns.md) for examples.
- **Background Generations**: Always check `list_connections` or poll `read_response` to see the progress of background tasks.
- **Activity Tracking**: Use the Activity Log to debug agent behavior and ensure progress is being made during deep research tasks.
