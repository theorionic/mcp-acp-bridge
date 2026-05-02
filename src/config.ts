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
    command: "claude-code-acp", // Adjust if needed
    args: [],
  },
};
