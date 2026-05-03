# Preconfigured Agents

The `mcp-acp-bridge` server supports the following agents out of the box:

| Agent Name | Command | Default Args |
| :--- | :--- | :--- |
| `gemini` | `gemini` | `["--acp"]` |
| `claude-code` | `claude-code-acp` | `[]` |
| `opencode` | `opencode` | `["--acp"]` |
| `codex` | `codex` | `["--acp"]` |
| `pi` | `pi` | `["--acp"]` |
| `aider` | `aider` | `["--acp"]` |

## Customizing Agents

You can pass extra flags to any agent during initialization using the `extraArgs` parameter.

**Example: Specifying a model for Gemini**
```json
{
  "agent": "gemini",
  "connectionId": "flash-agent",
  "extraArgs": ["--model", "gemini-2.0-flash"]
}
```
