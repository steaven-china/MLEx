import type { IncomingMessage } from "node:http";

import type { OpenAIChatRequestBody } from "./types.js";
import { resolveOpenClawSideBag } from "./normalize.js";
import { firstDefinedString, readHeaderValue } from "./utils.js";

export function isOpenClawBridgeRequest(req: IncomingMessage, body: OpenAIChatRequestBody): boolean {
  if (resolveOpenClawSideBag(body)) return true;
  if (body.openclaw || body.metadata?.openclaw) return true;

  const bridgeHintRaw = firstDefinedString([
    body.bridgeHint,
    body.bridge_hint,
    body.metadata?.bridgeHint,
    body.metadata?.bridge_hint,
    readHeaderValue(req.headers["x-openclaw-bridge"]),
    readHeaderValue(req.headers["x-mlex-bridge-hint"]),
    readHeaderValue(req.headers["x-mlex-bridge-mode"])
  ]);
  const bridgeHint = bridgeHintRaw?.toLowerCase();
  if (bridgeHint && ["1", "true", "openclaw", "bridge", "on", "mlex"].includes(bridgeHint)) {
    return true;
  }

  const userAgent = readHeaderValue(req.headers["user-agent"])?.toLowerCase();
  return typeof userAgent === "string" && userAgent.includes("openclaw");
}

export function shouldBypassNativeAgent(input: {
  openaiCompatBypassAgent: boolean;
  bridgeMode: "off" | "auto" | "force";
  hasOpenClawBridgeSignal: boolean;
}): boolean {
  if (input.openaiCompatBypassAgent) return true;
  if (input.bridgeMode === "force") return true;
  if (input.bridgeMode === "auto" && input.hasOpenClawBridgeSignal) return true;
  return false;
}
