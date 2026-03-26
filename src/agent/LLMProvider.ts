export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type TokenCallback = (token: string) => void;

export interface ILLMProvider {
  generate(messages: ChatMessage[]): Promise<string>;
  generateStream?(messages: ChatMessage[], onToken: TokenCallback): Promise<string>;
}
