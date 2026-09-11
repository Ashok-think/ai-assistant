import { jsonSchema, streamText, type ModelMessage, type ToolSet } from "ai";
import type { ChatMessage, LLMResult, ToolCall } from "./llm";
import type { ModelSpec } from "./router";

function convertMessages(messages: ChatMessage[]): ModelMessage[] {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) names.set(call.id, call.function.name);
    }
  }
  return messages.map((message): ModelMessage => {
    if (message.role === "tool") return {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: message.tool_call_id, toolName: names.get(message.tool_call_id) ?? "unknown", output: { type: "text", value: message.content } }],
    };
    if (message.role === "assistant") return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...(message.tool_calls ?? []).map((call) => ({ type: "tool-call" as const, toolCallId: call.id, toolName: call.function.name, input: JSON.parse(call.function.arguments || "{}") })),
      ],
    };
    return { role: message.role, content: message.content };
  });
}

export async function* gatewayCompletion(opts: {
  spec: ModelSpec; messages: ChatMessage[]; tools?: unknown[]; maxTokens?: number; timeoutMs?: number;
}): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; result: LLMResult }> {
  const tools: ToolSet = {};
  for (const raw of opts.tools ?? []) {
    const definition = raw as { function?: { name: string; description?: string; parameters: Parameters<typeof jsonSchema>[0] } };
    if (!definition.function) continue;
    const fn = definition.function;
    tools[fn.name] = { description: fn.description, inputSchema: jsonSchema(fn.parameters) };
  }
  const response = streamText({
    model: opts.spec.model,
    messages: convertMessages(opts.messages),
    tools: Object.keys(tools).length ? tools : undefined,
    maxOutputTokens: opts.maxTokens ?? 900,
    abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
    maxRetries: 0,
  });
  let content = "";
  const toolCalls: ToolCall[] = [];
  for await (const part of response.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") {
      content += part.text;
      yield { type: "delta", text: part.text };
    }
    if (part.type === "tool-call") toolCalls.push({ id: part.toolCallId, type: "function", function: { name: part.toolName, arguments: JSON.stringify(part.input) } });
  }
  const usage = await response.usage;
  yield { type: "done", result: { content, toolCalls, tokensIn: usage.inputTokens ?? 0, tokensOut: usage.outputTokens ?? 0 } };
}
