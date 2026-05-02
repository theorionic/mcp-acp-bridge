import { Client } from "@agentclientprotocol/sdk";

export class ACPClientHandler {
  public responseBuffer = "";

  public getClientImpl(): Client {
    return {
      requestPermission: async (params) => {
        if (params.options && params.options.length > 0) {
          // Find an accept/allow option if we want to auto-allow, or just pick the first one.
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
          if (update.status === "in_progress") {
            this.responseBuffer += `\n[Tool call: ${update.title}]\n`;
          }
        }
      },
    };
  }

  public resetBuffer() {
    this.responseBuffer = "";
  }
}
