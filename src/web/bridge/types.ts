export interface OpenAIChatMessagePart {
  type?: string;
  text?: string;
  content?: string;
  value?: string;
}

export interface OpenAIChatMessage {
  role?: string;
  content?: string | OpenAIChatMessagePart[] | null;
}

export interface OpenClawSideBag {
  model?: string;
  messages?: OpenAIChatMessage[];
  prompt?: string;
  input?: unknown;
  query?: string;
  message?: string;
  stream?: boolean;
  includeUsage?: boolean;
  include_usage?: boolean;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  request_id?: string;
}

export interface OpenClawSideBagContainer {
  sidecar?: OpenClawSideBag;
  sidebag?: OpenClawSideBag;
}

export interface OpenAIChatRequestBody {
  model?: string;
  bridgeHint?: string;
  bridge_hint?: string;
  messages?: OpenAIChatMessage[];
  prompt?: string;
  input?: unknown;
  query?: string;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
    includeUsage?: boolean;
  };
  user?: string;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  request_id?: string;
  sidecar?: OpenClawSideBag;
  sidebag?: OpenClawSideBag;
  openclaw?: OpenClawSideBagContainer;
  metadata?: {
    sessionId?: string;
    session_id?: string;
    requestId?: string;
    request_id?: string;
    bridgeHint?: string;
    bridge_hint?: string;
    sidecar?: OpenClawSideBag;
    sidebag?: OpenClawSideBag;
    openclaw?: OpenClawSideBagContainer;
  };
}

export interface NormalizedOpenAIChatRequest {
  message?: string;
  stream: boolean;
  includeUsage: boolean;
  sessionId: string;
  requestId?: string;
  model?: string;
}
