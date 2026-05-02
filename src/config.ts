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
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
  },
  opencode: {
    command: "opencode",
    args: ["acp"],
  },
  codex: {
    command: "codex-acp",
    args: [],
  },
  pi: {
    command: "pi-acp",
    args: [],
  },
  aider: {
    command: "aider",
    args: ["--acp"],
  },
};
