import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import { tryHandleOpenAiCompatPassthrough, type OpenAiCompatPassthroughInput } from "./forward.js";

export type BridgeMode = "off" | "auto" | "force";
export type BridgeRoutingReason = "explicit_bypass" | "mode_force" | "signal_auto" | "native";

export interface BridgeRoutingDecisionInput {
  openaiCompatBypassAgent: boolean;
  bridgeMode: BridgeMode;
  hasOpenClawBridgeSignal: boolean;
}

export interface BridgeRoutingDecision {
  bypassNativeAgent: boolean;
  reason: BridgeRoutingReason;
}

export interface ExecuteBridgePassthroughInput extends OpenAiCompatPassthroughInput {
  bridgeMode: BridgeMode;
  hasOpenClawBridgeSignal: boolean;
  openaiCompatBypassAgent: boolean;
  traceRecorder?: IDebugTraceRecorder;
}

export type BridgeExecutionStatus = "passthrough" | "fallback" | "unavailable" | "failed";

export interface BridgeExecutionResult {
  handled: boolean;
  status: BridgeExecutionStatus;
  errorCode?: "bridge_passthrough_unavailable" | "bridge_passthrough_failed";
  errorMessage?: string;
}

export function decideBridgeRouting(input: BridgeRoutingDecisionInput): BridgeRoutingDecision {
  if (input.openaiCompatBypassAgent) {
    return { bypassNativeAgent: true, reason: "explicit_bypass" };
  }
  if (input.bridgeMode === "force") {
    return { bypassNativeAgent: true, reason: "mode_force" };
  }
  if (input.bridgeMode === "auto" && input.hasOpenClawBridgeSignal) {
    return { bypassNativeAgent: true, reason: "signal_auto" };
  }
  return { bypassNativeAgent: false, reason: "native" };
}

export async function executeBridgePassthrough(
  input: ExecuteBridgePassthroughInput
): Promise<BridgeExecutionResult> {
  try {
    const handled = await tryHandleOpenAiCompatPassthrough({
      ...input,
      bridgeMode: input.bridgeMode,
      traceRecorder: input.traceRecorder
    });
    if (handled) {
      return { handled: true, status: "passthrough" };
    }
    if (input.bridgeMode === "force") {
      return {
        handled: false,
        status: "unavailable",
        errorCode: "bridge_passthrough_unavailable",
        errorMessage:
          "bridgeMode=force requires an OpenAI-compatible passthrough target, but none is configured."
      };
    }
    return { handled: false, status: "fallback" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.traceRecorder?.record("web.bridge", "forward.exception", {
      sessionId: input.request.sessionId,
      requestId: input.requestId,
      bridgeMode: input.bridgeMode,
      hasOpenClawBridgeSignal: input.hasOpenClawBridgeSignal,
      openaiCompatBypassAgent: input.openaiCompatBypassAgent,
      provider: input.runtime.config.service.provider,
      reason
    });
    return {
      handled: false,
      status: "failed",
      errorCode: "bridge_passthrough_failed",
      errorMessage: "OpenAI-compatible bridge passthrough failed."
    };
  }
}
