import { ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "stream";

// A simple script that acts like an ACP agent but produces errors
async function mockAgent() {
  // 1. Log some "infrastructure" errors to stderr immediately
  process.stderr.write("[DEBUG] Connection starting...\n");
  process.stderr.write("[ERROR] Quota exceeded for project-123\n");
  process.stderr.write("[ERROR] Billing account disabled\n");

  // 2. Standard ACP initialization handshake (Minimal)
  const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stdout = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  
  // We just wait and then exit to simulate a crash/failure after logging errors
  setTimeout(() => {
    process.exit(1);
  }, 1000);
}

mockAgent();
