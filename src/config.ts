export interface AgentConfig {
  command: string;
  args: string[];
  defaultCwd?: string;
  installInstructions: string;
}

export const PRECONFIGURED_AGENTS: Record<string, AgentConfig> = {
  gemini: {
    command: "gemini",
    args: ["--acp"],
    installInstructions: "npm install -g @google/gemini-cli",
  },
  "opencode": {
    command: "opencode",
    args: ["acp"],
    installInstructions: "npm install -g opencode-ai",
  },
};
