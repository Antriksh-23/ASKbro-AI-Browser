/**
 * ASKbro Gemini Client Service
 *
 * Implements typed calls to Google Gemini REST API (v1beta), supporting:
 * - Gemini 1.5 Flash-Lite (default fast & free) and Gemini 1.5 Flash
 * - Streaming responses via Server-Sent Events (streamGenerateContent?alt=sse)
 * - Structured prompt engineering & system instructions for TL;DR + 5 Takeaways + Next Steps
 * - English and Hinglish language modes
 * - Prompt injection containment via <untrusted_webpage_content> tagging
 * - Error classification (HTTP 429 rate limits, invalid keys, quota exceeded)
 */

import {
  GeminiContent,
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiGenerationConfig,
  GeminiSafetySetting,
  GeminiSystemInstruction,
  GenerateOptions,
  GenerateResult,
  OutputLanguage,
  StreamOptions,
  StructuredSummaryOutput,
  SummarizeOptions,
  SummaryResult,
  ConnectionTestResult,
  DEFAULT_GEMINI_MODEL,
} from '../../types/ai';
import { getGeminiApiKey, getSettings } from '../storage/settingsStore';
import {
  buildSummarizationSystemInstruction,
  buildYouTubeSummarizationSystemInstruction,
  wrapUntrustedContent,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
  splitTakeawayLeadIn,
  truncateForContext,
  summaryResultSchema,
} from './promptBuilder';

export {
  buildSummarizationSystemInstruction,
  buildYouTubeSummarizationSystemInstruction,
  wrapUntrustedContent,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
  splitTakeawayLeadIn,
  truncateForContext,
  summaryResultSchema,
};

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const FALLBACK_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

/**
 * Standard safety thresholds allowing technical and informational web summarization
 * without false-positive safety blocking.
 */
const DEFAULT_SAFETY_SETTINGS: GeminiSafetySetting[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

/**
 * Custom Gemini error classification
 */
export class GeminiError extends Error {
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly isRateLimit: boolean;
  public readonly isAuthError: boolean;
  public readonly isModelNotFound: boolean;
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
    this.name = 'GeminiError';
    this.status = options?.status;
    this.statusText = options?.statusText;
    this.details = options?.details;
    this.cause = options?.cause;

    const msgLower = message.toLowerCase();
    this.isRateLimit =
      options?.status === 429 ||
      msgLower.includes('quota') ||
      msgLower.includes('rate limit') ||
      msgLower.includes('resource_exhausted');

    this.isAuthError =
      options?.status === 401 ||
      options?.status === 403 ||
      (options?.status === 400 &&
        (msgLower.includes('api_key') ||
          msgLower.includes('key invalid') ||
          msgLower.includes('api key') ||
          msgLower.includes('permission_denied')));

    this.isModelNotFound = options?.status === 404 || msgLower.includes('not found');
  }
}

/**
 * Normalizes a model identifier, removing any accidental 'models/' prefix
 * and mapping retired/deprecated models to the current default model.
 */
export function normalizeModelName(modelName: string): string {
  const clean = modelName.trim().replace(/^models\//, '');
  if (
    clean === 'gemini-2.0-flash' ||
    !clean
  ) {
    return DEFAULT_GEMINI_MODEL;
  }
  return clean;
}

/**
 * Resolve active API key: options -> storage -> error
 */
async function resolveApiKey(explicitKey?: string): Promise<string> {
  const key = explicitKey?.trim() || (await getGeminiApiKey());
  if (!key || key.length < 10) {
    throw new GeminiError(
      'Gemini API key is not configured. Please enter your free API key in ASKbro Settings.',
      { status: 401 }
    );
  }
  return key;
}

/**
 * Resolve active model: options -> storage -> default
 */
async function resolveModelName(explicitModel?: string): Promise<string> {
  if (explicitModel?.trim()) {
    return normalizeModelName(explicitModel);
  }
  try {
    const settings = await getSettings();
    return normalizeModelName(settings.model || DEFAULT_GEMINI_MODEL);
  } catch {
    return normalizeModelName(DEFAULT_GEMINI_MODEL);
  }
}

/**
 * Formats user prompt or GeminiContent array into a standard contents array
 */
function normalizeContents(promptOrContents: string | GeminiContent[]): GeminiContent[] {
  if (typeof promptOrContents === 'string') {
    return [
      {
        role: 'user',
        parts: [{ text: promptOrContents }],
      },
    ];
  }
  return promptOrContents;
}

/**
 * Normalizes systemInstruction into standard GeminiSystemInstruction
 */
function normalizeSystemInstruction(
  instruction?: string | GeminiSystemInstruction
): GeminiSystemInstruction | undefined {
  if (!instruction) return undefined;
  if (typeof instruction === 'string') {
    return {
      parts: [{ text: instruction }],
    };
  }
  return instruction;
}

/**
 * Build request payload for Gemini API
 */
function buildRequestBody(
  contents: GeminiContent[],
  options?: GenerateOptions
): GeminiGenerateContentRequest {
  const generationConfig: GeminiGenerationConfig = {
    temperature: options?.temperature ?? 0.2,
    maxOutputTokens: options?.maxOutputTokens ?? 2048,
  };

  if (options?.responseMimeType) {
    generationConfig.responseMimeType = options.responseMimeType;
  }
  if (options?.responseSchema) {
    generationConfig.responseSchema = options.responseSchema;
  }

  const payload: GeminiGenerateContentRequest = {
    contents,
    generationConfig,
    safetySettings: DEFAULT_SAFETY_SETTINGS,
  };

  const sys = normalizeSystemInstruction(options?.systemInstruction);
  if (sys) {
    payload.systemInstruction = sys;
  }

  return payload;
}

/**
 * Parses Gemini API error response and throws a structured GeminiError
 */
async function handleApiError(response: Response): Promise<never> {
  let errorMsg = `Gemini API returned status ${response.status}: ${response.statusText}`;
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
    throw new GeminiError(
      `Gemini rate limit or quota exceeded (HTTP 429). ${errorMsg}`,
      { status: 429, statusText: response.statusText, details: errorDetails }
    );
  }

  if (response.status === 400 && errorMsg.toLowerCase().includes('key')) {
    throw new GeminiError(
      `Invalid Gemini API key. Please check your key from Google AI Studio. (${errorMsg})`,
      { status: 400, statusText: response.statusText, details: errorDetails }
    );
  }

  if (response.status === 403) {
    throw new GeminiError(
      `Permission denied. Please verify that the Generative Language API is enabled for this key. (${errorMsg})`,
      { status: 403, statusText: response.statusText, details: errorDetails }
    );
  }

  if (response.status === 404) {
    throw new GeminiError(
      `Requested model not found. Check model name or API version. (${errorMsg})`,
      { status: 404, statusText: response.statusText, details: errorDetails }
    );
  }

  throw new GeminiError(errorMsg, {
    status: response.status,
    statusText: response.statusText,
    details: errorDetails,
  });
}

/**
 * Extract clean output text from Gemini API response
 */
function extractResponseText(responseJson: GeminiGenerateContentResponse): string {
  const candidates = responseJson.candidates;
  if (!candidates || candidates.length === 0) {
    return '';
  }

  const parts = candidates[0].content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

// ---------------------------------------------------------------------------
// Core Gemini API Methods: Non-Streaming & Streaming
// ---------------------------------------------------------------------------

/**
 * Executes a standard non-streaming generation request to Gemini API
 *
 * @param promptOrContents Plain text prompt or structured GeminiContent array
 * @param options Model, API key, temperature, system instruction, etc.
 */
export async function generateContent(
  promptOrContents: string | GeminiContent[],
  options?: GenerateOptions
): Promise<GenerateResult> {
  const apiKey = await resolveApiKey(options?.apiKey);
  const model = await resolveModelName(options?.model);
  const contents = normalizeContents(promptOrContents);
  const requestBody = buildRequestBody(contents, options);

  const endpoint = `${GEMINI_API_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      if (response.status === 404 && !options?._isFallback) {
        for (const fallbackModel of FALLBACK_GEMINI_MODELS) {
          if (fallbackModel === model) continue;
          try {
            console.warn(
              `[ASKbro Gemini] Model "${model}" returned 404 Not Found. Attempting fallback model "${fallbackModel}"...`
            );
            const fallbackResult = await generateContent(promptOrContents, {
              ...options,
              model: fallbackModel,
              _isFallback: true,
            });
            console.info(`[ASKbro Gemini] Successfully generated content using fallback model "${fallbackModel}".`);
            return fallbackResult;
          } catch (fallbackErr: any) {
            if (fallbackErr?.status === 404 || fallbackErr?.isModelNotFound) {
              continue;
            }
            throw fallbackErr;
          }
        }
      }
      return await handleApiError(response);
    }

    const data: GeminiGenerateContentResponse = await response.json();
    const text = extractResponseText(data);
    const candidate = data.candidates?.[0];

    return {
      text,
      finishReason: candidate?.finishReason,
      usage: data.usageMetadata,
      rawResponse: data,
      model,
    };
  } catch (err: unknown) {
    if (err instanceof GeminiError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new GeminiError(`Network error communicating with Gemini API: ${errMessage}`, {
      cause: err,
    });
  }
}

/**
 * Executes a streaming generation request to Gemini API via Server-Sent Events (SSE).
 * Calls onChunk callback as each text token arrives.
 *
 * @param promptOrContents Plain text prompt or structured GeminiContent array
 * @param options Includes onChunk handler, model, key, and generation config
 */
export async function streamGenerateContent(
  promptOrContents: string | GeminiContent[],
  options?: StreamOptions
): Promise<GenerateResult> {
  const apiKey = await resolveApiKey(options?.apiKey);
  const model = await resolveModelName(options?.model);
  const contents = normalizeContents(promptOrContents);
  const requestBody = buildRequestBody(contents, options);

  // Gemini SSE streaming requires alt=sse
  const endpoint = `${GEMINI_API_BASE_URL}/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      if (response.status === 404 && !options?._isFallback) {
        for (const fallbackModel of FALLBACK_GEMINI_MODELS) {
          if (fallbackModel === model) continue;
          try {
            console.warn(
              `[ASKbro Gemini] Model "${model}" returned 404 Not Found during streaming. Attempting fallback model "${fallbackModel}"...`
            );
            const fallbackResult = await streamGenerateContent(promptOrContents, {
              ...options,
              model: fallbackModel,
              _isFallback: true,
            });
            console.info(`[ASKbro Gemini] Successfully streamed content using fallback model "${fallbackModel}".`);
            return fallbackResult;
          } catch (fallbackErr: any) {
            if (fallbackErr?.status === 404 || fallbackErr?.isModelNotFound) {
              continue;
            }
            throw fallbackErr;
          }
        }
      }
      return await handleApiError(response);
    }

    // Handle environment without streaming body (fallback)
    if (!response.body) {
      const data: GeminiGenerateContentResponse = await response.json();
      const text = extractResponseText(data);
      options?.onChunk?.(text, text);
      return {
        text,
        finishReason: data.candidates?.[0]?.finishReason,
        usage: data.usageMetadata,
        rawResponse: data,
        model,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    let accumulatedText = '';
    let lastCandidate: GeminiGenerateContentResponse['candidates'] = undefined;
    let finalUsage: GeminiGenerateContentResponse['usageMetadata'] = undefined;
    let lastResponseChunk: GeminiGenerateContentResponse | undefined = undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // The last segment may be an incomplete line; preserve it in buffer
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) {
            // Ignore empty lines and SSE ping comments
            continue;
          }

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === '[DONE]') {
              continue;
            }

            try {
              const chunkJson: GeminiGenerateContentResponse = JSON.parse(dataStr);
              lastResponseChunk = chunkJson;

              if (chunkJson.usageMetadata) {
                finalUsage = chunkJson.usageMetadata;
              }

              const candidate = chunkJson.candidates?.[0];
              if (candidate) {
                lastCandidate = chunkJson.candidates;
                const parts = candidate.content?.parts ?? [];
                const deltaText = parts.map((p) => p.text ?? '').join('');
                if (deltaText) {
                  accumulatedText += deltaText;
                  options?.onChunk?.(deltaText, accumulatedText);
                }
              }
            } catch {
              // Ignore partial or unparseable SSE line without aborting
            }
          }
        }
      }

      // Check remaining buffer after stream finishes
      if (buffer.trim().startsWith('data:')) {
        const dataStr = buffer.trim().slice(5).trim();
        if (dataStr && dataStr !== '[DONE]') {
          try {
            const chunkJson: GeminiGenerateContentResponse = JSON.parse(dataStr);
            lastResponseChunk = chunkJson;
            const parts = chunkJson.candidates?.[0]?.content?.parts ?? [];
            const deltaText = parts.map((p) => p.text ?? '').join('');
            if (deltaText) {
              accumulatedText += deltaText;
              options?.onChunk?.(deltaText, accumulatedText);
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
      finishReason: lastCandidate?.[0]?.finishReason,
      usage: finalUsage,
      rawResponse: lastResponseChunk,
      model,
    };
  } catch (err: unknown) {
    if (err instanceof GeminiError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new GeminiError(`Stream error communicating with Gemini API: ${errMessage}`, {
      cause: err,
    });
  }
}

// ---------------------------------------------------------------------------
// Structured Summarization Engine (TL;DR + 5 Takeaways + What to do next)
// Re-exported from promptBuilder.ts for backwards compatibility
// ---------------------------------------------------------------------------

/**
 * Main Structured Summarization caller: accepts content, streams or awaits generation,
 * with automated exponential backoff and Groq free-tier fallback on rate limits.
 */
export async function generateStructuredSummary(
  options: SummarizeOptions
): Promise<StructuredSummaryOutput> {
  const language = options.language || 'en';
  const isYouTube = Boolean(options.isYouTube);
  const systemInstruction = buildSummarizationSystemInstruction(language, isYouTube);
  const prompt = wrapUntrustedContent(options.content, options.title, options.url);

  const { executeResilientContent, streamResilientContent } = await import('./rateLimiter');
  let fullText = '';

  if (options.onChunk) {
    const result = await streamResilientContent(prompt, {
      apiKey: options.apiKey,
      groqApiKey: options.groqApiKey,
      groqModel: options.groqModel,
      model: options.model,
      systemInstruction,
      temperature: 0.2,
      maxOutputTokens: 2048,
      delays: options.delays,
      maxRetries: options.maxRetries,
      enableFallback: options.enableFallback,
      signal: options.signal,
      onFallback: options.onFallback,
      onRetry: options.onRetry,
      onChunk: options.onChunk,
    });
    fullText = result.text;
  } else {
    const result = await executeResilientContent(prompt, {
      apiKey: options.apiKey,
      groqApiKey: options.groqApiKey,
      groqModel: options.groqModel,
      model: options.model,
      systemInstruction,
      temperature: 0.2,
      maxOutputTokens: 2048,
      delays: options.delays,
      maxRetries: options.maxRetries,
      enableFallback: options.enableFallback,
      signal: options.signal,
      onFallback: options.onFallback,
      onRetry: options.onRetry,
    });
    fullText = result.text;
  }

  const parsed = parseStructuredSummary(fullText);
  const markdown = formatSummaryAsMarkdown(parsed);

  return {
    summary: parsed,
    markdown,
    rawText: fullText,
    language,
  };
}

/**
 * Helper to test Gemini API connection with a lightweight 1-token ping
 */
export async function testGeminiPing(
  apiKey: string,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<ConnectionTestResult> {
  const start = performance.now();
  const timestamp = Date.now();
  const cleanKey = apiKey.trim();

  if (!cleanKey) {
    return {
      provider: 'gemini',
      success: false,
      message: 'Please provide a valid Gemini API key.',
      timestamp,
    };
  }

  try {
    const res = await generateContent('ping', {
      apiKey: cleanKey,
      model: modelName,
      maxOutputTokens: 2,
      temperature: 0,
    });

    const latencyMs = Math.round(performance.now() - start);
    return {
      provider: 'gemini',
      success: Boolean(res.text || res.finishReason),
      message: `Connected to ${normalizeModelName(modelName)} successfully!`,
      latencyMs,
      timestamp,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider: 'gemini',
      success: false,
      message,
      latencyMs,
      timestamp,
    };
  }
}

