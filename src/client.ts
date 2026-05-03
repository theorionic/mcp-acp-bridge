import { Client } from "@agentclientprotocol/sdk";

export class ACPClientHandler {
  public responseBuffer = "";
  public toolLogs: string[] = [];

  public getClientImpl(): Client {
    return {
      requestPermission: async (params) => {
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
            this.responseBuffer += chunk.text;
          }
        } else if (params.update.sessionUpdate === "tool_call_update") {
          const update = params.update;
          const status = update.status || "updating";
          const title = update.title || "unnamed tool";
          
          const logEntry = `[Tool: ${title} | Status: ${status}]`;
          
          // Only add to log if it's a state change or new tool
          if (!this.toolLogs.includes(logEntry)) {
            this.toolLogs.push(logEntry);
            this.responseBuffer += `\n${logEntry}\n`;
          }
        }
      },
    };
  }

  public resetBuffer() {
    this.responseBuffer = "";
    this.toolLogs = [];
  }
}
