import { Client } from "@agentclientprotocol/sdk";

/**
 * Approval mode for tool calls requested by the agent.
 * - "auto": Automatically approve all tool calls (current behavior, default for backwards compat)
 * - "manual": Hold permission requests until explicitly approved via approve_tool_call
 */
export type ToolApprovalMode = "auto" | "manual";

/**
 * Represents a pending permission request waiting for approval.
 */
export interface PendingPermission {
  /** The JSON-RPC request ID from the agent */
  requestId: string;
  /** Description of the tool being called (from the permission request) */
  description: string;
  /** Available options the user can choose from */
  options: Array<{ kind: string; optionId: string; title?: string }>;
  /** Timestamp when the request was received */
  timestamp: number;
  /** Resolve function to call with the approval response */
  resolve: (response: { outcome: { outcome: string; optionId: string } }) => void;
}

/**
 * Detailed information about a tool call made by the agent.
 */
export interface ToolCallDetail {
  /** Unique ID for this tool call */
  toolCallId: string;
  /** Name/title of the tool being called */
  toolName: string;
  /** Current status: "updating" | "complete" | "error" */
  status: string;
  /** Timestamp when this tool call started */
  startedAt: number;
  /** Timestamp when this tool call completed (null if still running) */
  completedAt: number | null;
  /** Text content produced by the tool call */
  content: string[];
}

export class ACPClientHandler {
  public responseChunks: { type: "text" | "log"; text: string }[] = [];
  public toolLogs: string[] = [];
  public errorBuffer = "";

  public toolApprovalMode: ToolApprovalMode = "auto";
  public pendingPermissions: Map<string, PendingPermission> = new Map();
  public toolCallDetails: Map<string, ToolCallDetail> = new Map();
  public lastReadOffset: number = 0;

  public getClientImpl(): Client {
    return {
      requestPermission: async (params) => {
        if (this.toolApprovalMode === "manual") {
          return new Promise<{ outcome: { outcome: string; optionId: string } }>((resolve) => {
            const options = (params.options || []).map((o: any) => ({
              kind: o.kind || "unknown",
              optionId: o.optionId,
              title: o.title || undefined,
            }));

            const pending: PendingPermission = {
              requestId: params._meta?.requestId ? String(params._meta.requestId) : `perm_${Date.now()}`,
              description: params.description || "Tool permission request",
              options,
              timestamp: Date.now(),
              resolve,
            };

            this.pendingPermissions.set(pending.requestId, pending);
          });
        }

        if (params.options && params.options.length > 0) {
          const acceptOption =
            params.options.find((o: any) => o.kind === "accept" || o.kind === "allow") || params.options[0];
          return { outcome: { outcome: "selected", optionId: acceptOption.optionId } };
        }
        return { outcome: { outcome: "cancelled" } };
      },
      sessionUpdate: async (params) => {
        if (params.update.sessionUpdate === "agent_message_chunk") {
          const chunk = params.update.content;
          if (chunk.type === "text" && chunk.text) {
            this.responseChunks.push({ type: "text", text: chunk.text });
          }
        } else if (params.update.sessionUpdate === "tool_call" || params.update.sessionUpdate === "tool_call_update") {
          const update = params.update;
          const status = update.status || "updating";

          const toolName = update.toolCallId?.split("-")[0] || "unknown_tool";
          const title = update.title ? ` (${update.title})` : "";

          const logEntry = `[Tool: ${toolName}${title} | Status: ${status}]`;

          // Update tool call details map
          const existingDetail = this.toolCallDetails.get(update.toolCallId);
          if (existingDetail) {
            existingDetail.status = status;
            existingDetail.content.push(update.title || toolName);
            if (status === "complete" || status === "error") {
              existingDetail.completedAt = Date.now();
            }
          } else {
            this.toolCallDetails.set(update.toolCallId, {
              toolCallId: update.toolCallId,
              toolName: title ? update.title! : toolName,
              status,
              startedAt: Date.now(),
              completedAt: status === "complete" || status === "error" ? Date.now() : null,
              content: update.title ? [update.title] : [],
            });
          }

          if (!this.toolLogs.includes(logEntry)) {
            this.toolLogs.push(logEntry);
            this.responseChunks.push({ type: "log", text: logEntry });
          }
        }
      },
    };
  }

  /**
   * Approve a pending permission request.
   * Returns true if the permission was found and approved, false otherwise.
   */
  public approvePermission(requestId: string, optionIndex: number = 0): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;

    if (optionIndex < 0 || optionIndex >= pending.options.length) {
      optionIndex = 0;
    }

    const selectedOption = pending.options[optionIndex];
    pending.resolve({
      outcome: { outcome: "selected", optionId: selectedOption.optionId },
    });
    this.pendingPermissions.delete(requestId);
    return true;
  }

  /**
   * Deny a pending permission request (cancel it).
   * Returns true if the permission was found and denied, false otherwise.
   */
  public denyPermission(requestId: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;

    pending.resolve({ outcome: { outcome: "cancelled" } });
    this.pendingPermissions.delete(requestId);
    return true;
  }

  public handleStderr(data: string) {
    this.errorBuffer += data;
    if (this.errorBuffer.length > 2000) {
      this.errorBuffer = this.errorBuffer.slice(-2000);
    }
  }

  public resetBuffer() {
    this.responseChunks = [];
    this.toolLogs = [];
    this.errorBuffer = "";
    this.toolCallDetails.clear();
    this.lastReadOffset = 0;
  }

  /**
   * Reset for a new session while keeping the same connection process.
   * Clears conversation state but preserves connection.
   */
  public resetForNewSession() {
    this.responseChunks = [];
    this.toolLogs = [];
    this.errorBuffer = "";
    this.toolCallDetails.clear();
    this.pendingPermissions.clear();
    this.lastReadOffset = 0;
    this.isGenerating = false;
    this.currentError = null;
  }

  // Set by ACPServer for state tracking across connection resets
  public isGenerating: boolean = false;
  public currentError: string | null = null;
}