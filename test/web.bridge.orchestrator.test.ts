import type { IncomingMessage } from "node:http";
import { describe, expect, test } from "vitest";

import {
  decideBridgeRouting,
  isOpenClawBridgeRequest,
  type OpenAIChatRequestBody
} from "../src/web/bridge/openaiCompatBridge.js";

describe("web bridge orchestrator", () => {
  test("bridge routing decision matrix", () => {
    expect(
      decideBridgeRouting({
        openaiCompatBypassAgent: true,
        bridgeMode: "off",
        hasOpenClawBridgeSignal: false
      })
    ).toEqual({
      bypassNativeAgent: true,
      reason: "explicit_bypass"
    });

    expect(
      decideBridgeRouting({
        openaiCompatBypassAgent: false,
        bridgeMode: "force",
        hasOpenClawBridgeSignal: false
      })
    ).toEqual({
      bypassNativeAgent: true,
      reason: "mode_force"
    });

    expect(
      decideBridgeRouting({
        openaiCompatBypassAgent: false,
        bridgeMode: "auto",
        hasOpenClawBridgeSignal: true
      })
    ).toEqual({
      bypassNativeAgent: true,
      reason: "signal_auto"
    });

    expect(
      decideBridgeRouting({
        openaiCompatBypassAgent: false,
        bridgeMode: "off",
        hasOpenClawBridgeSignal: true
      })
    ).toEqual({
      bypassNativeAgent: false,
      reason: "native"
    });

    expect(
      decideBridgeRouting({
        openaiCompatBypassAgent: false,
        bridgeMode: "auto",
        hasOpenClawBridgeSignal: false
      })
    ).toEqual({
      bypassNativeAgent: false,
      reason: "native"
    });
  });

  test("detects bridge hint from unified header and payload fields", () => {
    const reqFromHeader = {
      headers: {
        "x-mlex-bridge-hint": "bridge",
        "user-agent": "unit-test-agent"
      }
    } as unknown as IncomingMessage;
    const bodyWithoutOpenClaw = {} as OpenAIChatRequestBody;
    expect(isOpenClawBridgeRequest(reqFromHeader, bodyWithoutOpenClaw)).toBe(true);

    const reqWithoutHintHeader = {
      headers: {
        "user-agent": "unit-test-agent"
      }
    } as unknown as IncomingMessage;
    const bodyWithHint = {
      bridgeHint: "openclaw"
    } as OpenAIChatRequestBody;
    expect(isOpenClawBridgeRequest(reqWithoutHintHeader, bodyWithHint)).toBe(true);
  });
});
