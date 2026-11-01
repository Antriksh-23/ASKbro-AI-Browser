/**
 * ASKbro Groq Cloud AI Service (Slice 2.4 Fallback Engine)
 *
 * Implements high-speed text completions and streaming via Groq Cloud API
 * (OpenAI-compatible /chat/completions endpoint), powering seamless free-tier
 * fallback when Google Gemini hits HTTP 429 rate limits or quota exhaustion.
 *
 * Supported Models on Groq Free Tier:
 * - Mixtral 8x7b (mixtral-8x7b-32768)
 * - Llama 3.3 70B (llama-3.3-70b-versatile)
 * - Llama 3.1 8B (llama-3.1-8b-instant)
 */

import {
  ConnectionTestResult,
  DEFAULT_GROQ_MODEL,
  GeminiContent,
  GeminiSystemInstruction,
  GenerateOptions,
  GenerateResult,
  GroqChatCompletionRequest,
  GroqChatCompletionResponse,
  GroqChatMessage,
  StreamOptions,
} from '../../types/ai';
import { getGroqApiKey } from '../storage/settingsStore';

export const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Custom Groq error classification
 */
export class GroqError extends Error {
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly isRateLimit: boolean;
  public readonly isAuthError: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      status?: number;
      statusText?: string;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'GroqError';
    this.status = options?.status;
    this.statusText = options?.statusText;
    this.details = options?.details;
    this.cause = options?.cause;

    const msgLower = message.toLowerCase();
    this.isRateLimit =
      options?.status === 429 ||
      msgLower.includes('quota') ||
      msgLower.includes('rate limit') ||
      msgLower.includes('rate_limit_exceeded') ||
      msgLower.includes('tokens');

    this.isAuthError =
      options?.status === 401 ||
      options?.status === 403 ||
      msgLower.includes('api key') ||
      msgLower.includes('unauthorized');
  }
}

/**
 * Checks if a given Gemini payload contains multimodal inline data (images)
 */
export function isMultimodalContents(promptOrContents: string | GeminiContent[] | GroqChatMessage[]): boolean {
  if (typeof promptOrContents === 'string') return false;
  if (!Array.isArray(promptOrContents)) return false;

  return (promptOrContents as any[]).some((item) => {
    if ('parts' in item && Array.isArray(item.parts)) {
      return item.parts.some((part: any) => 'inlineData' in part);
    }
    return false;
  });
}

/**
 * Resolves active Groq API key: options -> storage -> error
 */
export async function resolveGroqApiKey(explicitKey?: string): Promise<string> {
  const key = explicitKey?.trim() || (await getGroqApiKey());
  if (!key || key.length < 10) {
    throw new GroqError(
      'Groq Cloud API key is not configured. Please configure your free Groq key in ASKbro Settings to enable automated rate-limit fallback.',
      { status: 401 }
    );
  }
  return key;
}

/**
 * Converts Gemini contents/prompt and system instruction into OpenAI/Groq messages
 */
export function convertGeminiToGroqMessages(
  promptOrContents: string | GeminiContent[] | GroqChatMessage[],
  systemInstruction?: string | GeminiSystemInstruction
): GroqChatMessage[] {
  // If already array of GroqChatMessage
  if (Array.isArray(promptOrContents) && promptOrContents.length > 0 && 'role' in promptOrContents[0] && 'content' in promptOrContents[0]) {
    const groqMsgs = [...(promptOrContents as GroqChatMessage[])];
    if (systemInstruction) {
      const sysText = typeof systemInstruction === 'string'
        ? systemInstruction
        : systemInstruction.parts.map((p) => p.text).join('\n');
      if (sysText.trim()) {
        groqMsgs.unshift({ role: 'system', content: sysText.trim() });
      }
    }
    return groqMsgs;
  }

  const messages: GroqChatMessage[] = [];

  // 1. Process System Instruction if present
  if (systemInstruction) {
    let sysText = '';
    if (typeof systemInstruction === 'string') {
      sysText = systemInstruction;
    } else if (systemInstruction.parts) {
      sysText = systemInstruction.parts.map((p) => p.text).join('\n');
    }
    if (sysText.trim()) {
      messages.push({ role: 'system', content: sysText.trim() });
    }
  }

  // 2. Process User Prompt or GeminiContent Array
  if (typeof promptOrContents === 'string') {
    messages.push({ role: 'user', content: promptOrContents });
  } else if (Array.isArray(promptOrContents)) {
    for (const item of promptOrContents as GeminiContent[]) {
      const role: 'system' | 'user' | 'assistant' =
        item.role === 'model' ? 'assistant' : item.role === 'system' ? 'system' : 'user';

      const textParts: string[] = [];
      for (const part of item.parts || []) {
        if ('text' in part && part.text) {
          textParts.push(part.text);
        } else if ('inlineData' in part) {
          // Multimodal images not supported in Groq text endpoints
          textParts.push('[Screenshot/Image attached - Multimodal query]');
        }
      }

      const content = textParts.join('\n');
      if (content) {
        messages.push({ role, content });
      }
    }
  }

  return messages;
}

/**
 * Parses Groq API error response and throws structured GroqError
 */
async function handleGroqApiError(response: Response): Promise<never> {
  let errorMsg = `Groq API returned status ${response.status}: ${response.statusText}`;
  let errorDetails: unknown = undefined;

  try {
    const errorJson = await response.json();
    errorDetails = errorJson;
    if (errorJson?.error?.message) {
      errorMsg = errorJson.error.message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) errorMsg = `${errorMsg} - ${text.substring(0, 200)}`;
    } catch {
      // Ignore text decoding failure
    }
  }

  if (response.status === 429) {
    throw new GroqError(`Groq rate limit or quota exceeded (HTTP 429). ${errorMsg}`, {
      status: 429,
      statusText: response.statusText,
      details: errorDetails,
    });
  }

  if (response.status === 401) {
    throw new GroqError(`Invalid Groq API key. Please check your key from Groq Console. (${errorMsg})`, {
      status: 401,
      statusText: response.statusText,
      details: errorDetails,
    });
  }

  throw new GroqError(errorMsg, {
    status: response.status,
    statusText: response.statusText,
    details: errorDetails,
  });
}

/**
 * Builds request payload for Groq OpenAI-compatible Chat API
 */
function buildGroqRequestBody(
  messages: GroqChatMessage[],
  options?: GenerateOptions & { groqModel?: string; stream?: boolean }
): GroqChatCompletionRequest {
  const model = options?.groqModel || DEFAULT_GROQ_MODEL;

  return {
    model,
    messages,
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxOutputTokens ?? 2048,
    stream: options?.stream ?? false,
  };
}

/**
 * Non-streaming chat completion via Groq Cloud API
 */
export async function generateGroqContent(
  promptOrContents: string | GeminiContent[] | GroqChatMessage[],
  options?: GenerateOptions & { groqModel?: string }
): Promise<GenerateResult> {
  const apiKey = await resolveGroqApiKey(options?.apiKey);
  const messages = convertGeminiToGroqMessages(promptOrContents, options?.systemInstruction);
  const requestBody = buildGroqRequestBody(messages, { ...options, stream: false });

  try {
    const response = await fetch(GROQ_API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      return await handleGroqApiError(response);
    }

    const data: GroqChatCompletionResponse = await response.json();
    const candidate = data.choices?.[0];
    const text = candidate?.message?.content || '';

    return {
      text,
      finishReason: candidate?.finish_reason,
      usage: data.usage
        ? {
            promptTokenCount: data.usage.prompt_tokens,
            candidatesTokenCount: data.usage.completion_tokens,
            totalTokenCount: data.usage.total_tokens,
          }
        : undefined,
      rawResponse: data as any,
    };
  } catch (err: unknown) {
    if (err instanceof GroqError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new GroqError(`Network error communicating with Groq API: ${errMessage}`, {
      cause: err,
    });
  }
}

/**
 * Real-time SSE streaming chat completion via Groq Cloud API
 */
export async function streamGroqContent(
  promptOrContents: string | GeminiContent[] | GroqChatMessage[],
  options?: StreamOptions & { groqModel?: string }
): Promise<GenerateResult> {
  const apiKey = await resolveGroqApiKey(options?.apiKey);
  const messages = convertGeminiToGroqMessages(promptOrContents, options?.systemInstruction);
  const requestBody = buildGroqRequestBody(messages, { ...options, stream: true });

  try {
    const response = await fetch(GROQ_API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      return await handleGroqApiError(response);
    }

    // Fallback if environment doesn't provide stream body
    if (!response.body) {
      const data: GroqChatCompletionResponse = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      options?.onChunk?.(text, text);
      return {
        text,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: data.usage
          ? {
              promptTokenCount: data.usage.prompt_tokens,
              candidatesTokenCount: data.usage.completion_tokens,
              totalTokenCount: data.usage.total_tokens,
            }
          : undefined,
        rawResponse: data as any,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let accumulatedText = '';
    let finishReason: string | undefined = undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const chunkJson: GroqChatCompletionResponse = JSON.parse(dataStr);
              const choice = chunkJson.choices?.[0];
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }

              const delta = choice?.delta?.content;
              if (delta) {
                accumulatedText += delta;
                options?.onChunk?.(delta, accumulatedText);
              }
            } catch {
              // Ignore partial JSON chunks
            }
          }
        }
      }

      // Check any trailing data in buffer
      if (buffer.trim().startsWith('data:')) {
        const dataStr = buffer.trim().slice(5).trim();
        if (dataStr && dataStr !== '[DONE]') {
          try {
            const chunkJson: GroqChatCompletionResponse = JSON.parse(dataStr);
            const delta = chunkJson.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedText += delta;
              options?.onChunk?.(delta, accumulatedText);
            }
          } catch {
            // Ignore
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: accumulatedText,
      finishReason,
    };
  } catch (err: unknown) {
    if (err instanceof GroqError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new GroqError(`Stream error communicating with Groq API: ${errMessage}`, {
      cause: err,
    });
  }
}

/**
 * Tests Groq API connectivity with a lightweight 1-token test ping
 */
export async function testGroqPing(
  apiKey: string,
  modelName: string = DEFAULT_GROQ_MODEL
): Promise<ConnectionTestResult> {
  const start = performance.now();
  const timestamp = Date.now();
  const cleanKey = apiKey.trim();

  if (!cleanKey) {
    return {
      provider: 'groq',
      success: false,
      message: 'Please provide a valid Groq Cloud API key.',
      timestamp,
    };
  }

  try {
    const res = await generateGroqContent('ping', {
      apiKey: cleanKey,
      groqModel: modelName,
      maxOutputTokens: 2,
      temperature: 0,
    });

    const latencyMs = Math.round(performance.now() - start);
    return {
      provider: 'groq',
      success: Boolean(res.text || res.finishReason),
      message: `Connected to Groq (${modelName}) successfully!`,
      latencyMs,
      timestamp,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider: 'groq',
      success: false,
      message,
      latencyMs,
      timestamp,
    };
  }
}

