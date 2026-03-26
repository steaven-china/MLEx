import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface OpenAIProviderConfig extends ChatCompletionProviderConfig {}

export class OpenAIProvider extends ChatCompletionProvider {
  constructor(
    config: OpenAIProviderConfig,
    options?: {
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      onTrace: options?.onTrace
    });
  }
}
