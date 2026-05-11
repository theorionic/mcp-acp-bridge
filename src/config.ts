export interface AgentConfig {
  command: string;
  args: string[];
  defaultCwd?: string;
  installInstructions: string;
  supportsManualApproval?: boolean;
  unsupportedArgs?: string[];
}

export const PRECONFIGURED_AGENTS: Record<string, AgentConfig> = {
  gemini: {
    command: "gemini",
    args: ["--acp"],
    installInstructions: "npm install -g @google/gemini-cli",
    supportsManualApproval: true,
  },
  "opencode": {
    command: "opencode",
    args: ["acp"],
    installInstructions: "npm install -g opencode-ai",
    supportsManualApproval: false,
    unsupportedArgs: ["--model", "-m", "--sandbox", "-s"],
  },
};
