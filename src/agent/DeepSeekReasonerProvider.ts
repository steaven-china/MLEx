import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface DeepSeekReasonerProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class DeepSeekReasonerProvider extends ChatCompletionProvider {
  constructor(
    config: DeepSeekReasonerProviderConfig,
    options?: {
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    const providerConfig: ChatCompletionProviderConfig = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model ?? "deepseek-reasoner"
    };
    super(providerConfig, {
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      onTrace: options?.onTrace
    });
  }
}
