import { describe, expect, test } from "vitest";

import { StdioMcpClient } from "../src/mcp/StdioMcpClient.js";

const MOCK_MCP_SERVER_SCRIPT = `
let buffer = Buffer.alloc(0);
function writeMessage(payload) {
  const json = JSON.stringify(payload);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json, "utf8") + "\\r\\n\\r\\n" + json);
}
function drain() {
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/content-length\\s*:\\s*(\\d+)/i);
    if (!match) return;
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    const message = JSON.parse(body);
    handle(message);
  }
}
function handle(message) {
  if (message.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: "mock-mcp", version: "1.0.0" }
      }
    });
    return;
  }
  if (message.method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          { name: "echo", description: "echo text", inputSchema: { type: "object" } }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: "ok" }],
        isError: false,
        input: message.params?.arguments ?? {}
      }
    });
    return;
  }
  if (message.id !== undefined) {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" }
    });
  }
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});
`;

describe("StdioMcpClient", () => {
  test("initializes, lists tools, and calls tool", async () => {
    const client = new StdioMcpClient({
      command: process.execPath,
      args: ["-e", MOCK_MCP_SERVER_SCRIPT],
      initTimeoutMs: 10_000
    });

    try {
      const tools = await client.listTools(10_000);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("echo");

      const called = await client.callTool("echo", { text: "hello" }, 10_000);
      const payload = called as { isError?: boolean; input?: { text?: string } };
      expect(payload.isError).toBe(false);
      expect(payload.input?.text).toBe("hello");
    } finally {
      await client.close();
    }
  });
});
