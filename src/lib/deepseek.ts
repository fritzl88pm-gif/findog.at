export {
  LLM_CHAT_TIMEOUT_MS as DEEPSEEK_CHAT_TIMEOUT_MS,
  chatCompletion,
} from "./llm/client";
export type {
  AppChatMessage,
  LlmMessage as DeepSeekMessage,
  LlmResult as DeepSeekResult,
  LlmToolCall as DeepSeekToolCall,
} from "./llm/client";
