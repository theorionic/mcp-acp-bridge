export interface AgentConfig {
  command: string;
  args: string[];
  defaultCwd?: string;
}

export const PRECONFIGURED_AGENTS: Record<string, AgentConfig> = {
  gemini: {
    command: "gemini",
    args: ["--acp"],
  },
  "claude-code": {
    command: "claude-code-acp",
    args: [],
  },
  "opencode": {
    command: "opencode",
    args: ["--acp"],
  },
  "codex": {
    command: "codex",
    args: ["--acp"],
  },
  "pi": {
    command: "pi",
    args: ["--acp"],
  },
  "aider": {
    command: "aider",
    args: ["--acp"],
  },
};
