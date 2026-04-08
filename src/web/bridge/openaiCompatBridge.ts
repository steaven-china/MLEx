export type {
  NormalizedOpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIChatMessagePart,
  OpenAIChatRequestBody,
  OpenClawSideBag
} from "./types.js";
export type {
  BridgeMode,
  BridgeRoutingDecision,
  BridgeRoutingDecisionInput,
  BridgeRoutingReason,
  BridgeExecutionResult,
  BridgeExecutionStatus,
  ExecuteBridgePassthroughInput
} from "./orchestrator.js";
export { normalizeOpenAIChatRequest } from "./normalize.js";
export { isOpenClawBridgeRequest, shouldBypassNativeAgent } from "./detect.js";
export { tryHandleOpenAiCompatPassthrough, type OpenAiCompatPassthroughInput } from "./forward.js";
export { decideBridgeRouting, executeBridgePassthrough } from "./orchestrator.js";
