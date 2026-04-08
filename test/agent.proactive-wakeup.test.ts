import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, MemoryEvent, ProactivePlan } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  public tickCount = 0;

  constructor(private readonly context: Context) {}

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async getContext(_query: string): Promise<Context> {
    return this.context;
  }

  async sealCurrentBlock(): Promise<void> {}

  createNewBlock(): void {}

  async retrieveBlocks(): Promise<BlockRef[]> {
    return [];
  }

  async tickProactiveWakeup(): Promise<void> {
    this.tickCount += 1;
  }
}

class MockProvider implements ILLMProvider {
  public readonly calls: ChatMessage[][] = [];

  async generate(_messages: ChatMessage[]): Promise<string> {
    this.calls.push(_messages);
    return "常规回答";
  }
}

describe("Agent proactive wakeup", () => {
  test("triggers proactive planner and actuator after normal response", async () => {
    const memory = new FakeMemoryManager({
      blocks: [],
      recentEvents: [],
      formatted: "",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.92 }],
        reason: "inject_ready",
        evidenceNeedHint: "none",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    let plannerCalled = 0;
    let actuatorCalled = 0;
    let plannerInput = "";
    let actuatorPlan: ProactivePlan | undefined;

    const planner = {
      buildPlan(input: { userInput: string; context: Context }): ProactivePlan {
        plannerCalled += 1;
        plannerInput = input.userInput;
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "继续推进",
          reason: "inject_ready"
        };
      }
    };

    const actuator = {
      async execute(plan: ProactivePlan): Promise<string> {
        actuatorCalled += 1;
        actuatorPlan = plan;
        return "主动消息";
      }
    };

    const agent = new Agent(memory, new MockProvider(), {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never
    });

    const result = await agent.respond("请继续");

    expect(result.text).toBe("常规回答");
    expect(result.proactiveText).toBe("主动消息");
    expect(plannerCalled).toBeGreaterThanOrEqual(1);
    expect(plannerInput).toBe("请继续");
    expect(actuatorCalled).toBe(1);
    expect(actuatorPlan?.action).toBe("ask_followup");
    expect(memory.events.map((event) => event.role)).toEqual(["user", "assistant"]);
  });

  test("supports timer-triggered proactive wakeup without user event", async () => {
    const memory = new FakeMemoryManager({
      blocks: [],
      recentEvents: [],
      formatted: "",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.92 }],
        reason: "inject_ready",
        evidenceNeedHint: "none",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    const planner = {
      buildPlan(): ProactivePlan {
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "继续推进",
          reason: "inject_ready"
        };
      }
    };

    const actuator = {
      async execute(): Promise<string> {
        return "主动消息";
      }
    };

    const agent = new Agent(memory, new MockProvider(), {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never
    });

    const proactiveText = await agent.tickProactiveWakeup();

    expect(proactiveText).toBe("主动消息");
    expect(memory.tickCount).toBe(1);
    expect(memory.events).toHaveLength(0);
  });

  test("uses model-generated follow-up for low entropy proactive reason", async () => {
    const memory = new FakeMemoryManager({
      blocks: [
        {
          id: "b1",
          score: 0.81,
          source: "fusion",
          summary: "支付重试链路里 webhook 去重和库存回滚关系不完整",
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          keywords: ["支付", "webhook", "去重", "回滚"]
        }
      ],
      recentEvents: [
        {
          id: "evt-1",
          role: "user",
          text: "库存回滚链路为什么没闭环？",
          timestamp: Date.now() - 500
        }
      ],
      formatted: "FORMATTED_CONTEXT_FULL",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "支付重试修复", confidence: 0.92 }],
        reason: "low_entropy_soft",
        evidenceNeedHint: "search_optional",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    let providerRound = 0;
    const provider: ILLMProvider = {
      async generate(messages: ChatMessage[]): Promise<string> {
        providerRound += 1;
        if (providerRound === 1) return "常规回答";
        expect(messages[0]?.role).toBe("system");
        expect(messages[0]?.content).toContain("检索诊断助手");
        expect(messages[1]?.content).toContain("full_context_json");
        expect(messages[1]?.content).toContain("FORMATTED_CONTEXT_FULL");
        expect(messages[1]?.content).toContain("库存回滚链路为什么没闭环");
        return "你能补充一下 webhook 去重失败与库存回滚之间的因果链路吗？";
      }
    };

    let capturedPlan: ProactivePlan | undefined;
    const planner = {
      buildPlan(): ProactivePlan {
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "默认追问",
          reason: "low_entropy_soft"
        };
      }
    };
    const actuator = {
      async execute(plan: ProactivePlan): Promise<string> {
        capturedPlan = plan;
        return plan.messageSeed;
      }
    };

    const agent = new Agent(memory, provider, {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never,
      i18n: {
        locale: "zh-CN",
        fallbackLocale: "zh-CN",
        messages: {},
        t(key: string): string {
          if (key === "agent.proactive_followup.system") {
            return "你是检索诊断助手";
          }
          return key;
        },
        raw(): string | undefined {
          return undefined;
        }
      }
    });

    const result = await agent.respond("继续推进");

    expect(result.text).toBe("常规回答");
    expect(result.proactiveText).toContain("因果链路");
    expect(capturedPlan?.messageSeed).toContain("因果链路");
    expect(providerRound).toBe(2);
  });

  test("suppresses proactive follow-up when questioning is disabled by tool control", async () => {
    const now = Date.now();
    const memory = new FakeMemoryManager({
      blocks: [],
      recentEvents: [
        {
          id: "evt-tool-1",
          role: "tool",
          text: "agent proactive questioning\nenabled: false",
          timestamp: now - 1000,
          metadata: {
            tool: "agent.proactive.questioning",
            questioningEnabled: false,
            reason: "user asked to stop follow-up questions",
            updatedAt: now - 1000
          }
        }
      ],
      formatted: "",
      proactiveSignal: {
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.92 }],
        reason: "low_entropy_soft",
        evidenceNeedHint: "none",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      }
    });

    let providerRound = 0;
    const provider: ILLMProvider = {
      async generate(): Promise<string> {
        providerRound += 1;
        return "常规回答";
      }
    };

    let actuatorCalled = 0;
    const planner = {
      buildPlan(): ProactivePlan {
        return {
          action: "ask_followup",
          shouldSearchEvidence: false,
          searchQueries: [],
          messageSeed: "默认追问",
          reason: "low_entropy_soft"
        };
      }
    };
    const actuator = {
      async execute(): Promise<string> {
        actuatorCalled += 1;
        return "主动消息";
      }
    };

    const agent = new Agent(memory, provider, {
      proactivePlanner: planner as never,
      proactiveActuator: actuator as never
    });

    const result = await agent.respond("继续推进");

    expect(result.text).toBe("常规回答");
    expect(result.proactiveText).toBeUndefined();
    expect(providerRound).toBe(1);
    expect(actuatorCalled).toBe(0);
  });

});
