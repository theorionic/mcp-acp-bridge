# Multi-Agent Workflow Patterns

The `mcp-acp-bridge` allows you to orchestrate multiple agents for complex tasks.

## 1. Parallel Tasking
Initialize multiple agents to work on different parts of a project simultaneously.

**Step 1: Initialize Agents**
- `initialize_client({ agent: "gemini", connectionId: "frontend", cwd: "./web" })`
- `initialize_client({ agent: "gemini", connectionId: "backend", cwd: "./server" })`

**Step 2: Dispatch Tasks**
- `send_prompt({ connectionId: "frontend", prompt: "Refactor the navigation bar to use Tailwind CSS.", wait: false })`
- `send_prompt({ connectionId: "backend", prompt: "Add a new API endpoint for user profile updates.", wait: false })`

**Step 3: Monitor and Collect**
Use `list_connections` to see when they finish, then `read_response` for each.

## 2. Specialized Roles
Use different agents for different types of work.

- Use `gemini` for general coding and research.
- Use `claude-code` for architectural review or complex refactoring.
- Use `aider` for quick file-level edits.

## 3. Real-time Monitoring
If a task is taking a long time, use `read_response({ connectionId: "ID", wait: false })` to check the **Activity Log**. This shows which tools the agent is currently running (e.g., `[Tool: list_directory | Status: completed]`), proving the system isn't hung.
