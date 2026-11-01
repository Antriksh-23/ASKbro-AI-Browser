/**
 * ASKbro Free-Tier Resilience & Fallback Engine (Slice 2.4)
 *
 * Implements:
 * - HTTP 429 / Quota Exceeded error interception across Gemini & Groq
 * - Exponential backoff retry mechanism (1s -> 2s -> 4s)
 * - Automatic fallback to Groq Cloud API (Mixtral 8x7b / Llama 3 on free tier) for text queries
 * - Multimodal quota guard (banners without crashing when image models rate-limit)
 * - Cooldown tracking & informative banner formatting:
 *   "Daily free-tier quota reached. Retry in X seconds or configure fallback key."
 */

import {
  AIProvider,
  GeminiContent,
  GenerateOptions,
  GenerateResult,
  RateLimiterOptions,
  RateLimitStatus,
  ResilientExecutionOptions,
  ResilientExecutionResult,
  StreamOptions,
  DEFAULT_GROQ_MODEL,
} from '../../types/ai';
import { GeminiError, generateContent, streamGenerateContent } from './gemini';
import {
  GroqError,
  generateGroqContent,
  streamGroqContent,
  isMultimodalContents,
} from './groq';
import { getGroqApiKey } from '../storage/settingsStore';

/**
 * Standard exponential backoff retry intervals in milliseconds (1s -> 2s -> 4s)
 */
export const DEFAULT_BACKOFF_DELAYS = [1000, 2000, 4000];

/**
 * Default cooldown time when HTTP 429 is received without an explicit Retry-After header
 */
export const DEFAULT_COOLDOWN_SECONDS = 30;

/**
 * Default maximum character threshold for prompt truncation (Technical Debt Mitigation)
 * Keeps prompt payload under ~6,000-8,000 tokens to mitigate HTTP 429 TPM exhaustion.
 */
export const DEFAULT_MAX_PROMPT_CHARS = 24000;

/**
 * Truncates text prompt to fit model token boundaries and mitigate HTTP 429 rate limits.
 * Intelligently cuts at word boundaries and attaches notice tag.
 */
export function truncatePromptForRateLimit(
  prompt: string,
  maxChars: number = DEFAULT_MAX_PROMPT_CHARS
): { text: string; wasTruncated: boolean; originalLength: number } {
  const originalLength = prompt.length;
  if (originalLength <= maxChars) {
    return { text: prompt, wasTruncated: false, originalLength };
  }

  // Find nearest whitespace before maxChars
  let cutIndex = prompt.lastIndexOf(' ', maxChars);
  if (cutIndex < maxChars * 0.8) {
    cutIndex = maxChars;
  }

  const truncated =
    prompt.substring(0, cutIndex).trim() +
    '\n\n[ASKbro Notice: Content truncated to fit model token rate limit boundaries]';
  return {
    text: truncated,
    wasTruncated: true,
    originalLength,
  };
}

/**
 * Asynchronously pauses execution for specified milliseconds, with AbortSignal cancellation
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Checks whether an error signifies an HTTP 429, quota exhaustion, or rate limit
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;

  if (typeof error === 'object') {
    const anyErr = error as any;
    if (anyErr.isRateLimit === true) return true;
    if (anyErr.status === 429) return true;
    if (anyErr.code === 429 || anyErr.code === 'RESOURCE_EXHAUSTED' || anyErr.code === 'rate_limit_exceeded') {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const msgLower = message.toLowerCase();

  return (
    msgLower.includes('429') ||
    msgLower.includes('quota') ||
    msgLower.includes('rate limit') ||
    msgLower.includes('resource_exhausted') ||
    msgLower.includes('too many requests') ||
    msgLower.includes('rate_limit_exceeded') ||
    msgLower.includes('tokens per minute')
  );
}

/**
 * Extracts retry-after duration in seconds from error object, headers, or messages
 */
export function getRetryAfterSeconds(error: unknown, fallbackSeconds: number = DEFAULT_COOLDOWN_SECONDS): number {
  if (!error) return fallbackSeconds;

  const anyErr = error as any;

  // 1. Direct retryAfter property
  if (typeof anyErr.retryAfterSeconds === 'number' && anyErr.retryAfterSeconds > 0) {
    return Math.ceil(anyErr.retryAfterSeconds);
  }

  // 2. HTTP headers (e.g., Response headers)
  if (anyErr.details && typeof anyErr.details === 'object') {
    const details = anyErr.details;
    if (details.retryAfter) {
      const parsed = parseInt(String(details.retryAfter), 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  // 3. Regex match in error message (e.g. "retry after 18 seconds", "please retry after 42s", "try again in 15s")
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:retry|wait|again in|after)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|seconds)?/i);
  if (match && match[1]) {
    const parsed = Math.ceil(parseFloat(match[1]));
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallbackSeconds;
}

/**
 * Formats standard non-crashing banner message for rate limit & quota exhaustion
 * Pattern required by Slice 2.4: "Daily free-tier quota reached. Retry in X seconds or configure fallback key."
 */
export function formatQuotaBannerMessage(seconds: number): string {
  return `Daily free-tier quota reached. Retry in ${Math.max(1, Math.ceil(seconds))} seconds or configure fallback key.`;
}

/**
 * Custom error thrown when daily quota is exhausted and no fallback is available
 * Extends GeminiError for backward compatibility with existing catch blocks
 */
export class QuotaExceededError extends GeminiError {
  public readonly retryAfterSeconds: number;
  public readonly isMultimodal: boolean;
  public readonly bannerMessage: string;
  public readonly provider: AIProvider;

  constructor(options?: {
    message?: string;
    retryAfterSeconds?: number;
    isMultimodal?: boolean;
    provider?: AIProvider;
    cause?: unknown;
  }) {
    const retryAfter = options?.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS;
    const banner = formatQuotaBannerMessage(retryAfter);
    const fullMsg = options?.message || banner;

    super(fullMsg, {
      status: 429,
      statusText: 'Too Many Requests (Quota Exceeded)',
      cause: options?.cause,
    });

    this.name = 'QuotaExceededError';
    this.retryAfterSeconds = retryAfter;
    this.isMultimodal = Boolean(options?.isMultimodal);
    this.bannerMessage = banner;
    this.provider = options?.provider || 'gemini';
  }
}

/**
 * Global rate-limit state and cooldown tracker
 */
export class RateLimitTracker {
  private static cooldowns: Record<AIProvider, number> = {
    gemini: 0,
    groq: 0,
  };

  /**
   * Records a rate limit event, establishing a cooldown period
   */
  public static recordRateLimit(provider: AIProvider, retryAfterSeconds: number = DEFAULT_COOLDOWN_SECONDS): void {
    const expiry = Date.now() + Math.max(1, retryAfterSeconds) * 1000;
    this.cooldowns[provider] = Math.max(this.cooldowns[provider] || 0, expiry);
  }

  /**
   * Checks if a provider is actively in cooldown
   */
  public static isRateLimited(provider: AIProvider = 'gemini'): boolean {
    return Date.now() < (this.cooldowns[provider] || 0);
  }

  /**
   * Returns remaining cooldown seconds, or 0 if ready
   */
  public static getCooldownRemainingSeconds(provider: AIProvider = 'gemini'): number {
    const remainingMs = (this.cooldowns[provider] || 0) - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  /**
   * Clears the cooldown for a provider or all providers
   */
  public static clearCooldown(provider?: AIProvider): void {
    if (provider) {
      this.cooldowns[provider] = 0;
    } else {
      this.cooldowns.gemini = 0;
      this.cooldowns.groq = 0;
    }
  }

  /**
   * Gets current status object for diagnostics and UI banners
   */
  public static getStatus(provider: AIProvider = 'gemini'): RateLimitStatus {
    const seconds = this.getCooldownRemainingSeconds(provider);
    return {
      isRateLimited: seconds > 0,
      retryAfterSeconds: seconds,
      bannerMessage: formatQuotaBannerMessage(seconds || DEFAULT_COOLDOWN_SECONDS),
      provider,
      timestamp: Date.now(),
    };
  }
}

/**
 * Executes an asynchronous function with exponential backoff on HTTP 429 rate limits
 *
 * @param fn Function to execute with attempt count (1-based)
 * @param options Retry delays, maxRetries, callbacks, and abort signal
 */
export async function withExponentialBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RateLimiterOptions
): Promise<T> {
  const delays = options?.delays ?? DEFAULT_BACKOFF_DELAYS;
  const maxRetries = options?.maxRetries ?? delays.length;
  const signal = options?.signal;

  let attempt = 1;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn(attempt);
    } catch (err: unknown) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err;
      }

      const isRetryable = options?.shouldRetry
        ? options.shouldRetry(err, attempt)
        : isRateLimitError(err);

      if (!isRetryable || attempt > maxRetries) {
        throw err;
      }

      const delayMs = delays[attempt - 1] ?? delays[delays.length - 1] ?? 1000;
      options?.onRetry?.(err, attempt, delayMs);

      await sleep(delayMs, signal);
      attempt++;
    }
  }
}

/**
 * Resilient Non-Streaming AI Execution:
 * 1. Checks if multimodal (images); if so, executes Gemini with backoff only (no Groq text fallback).
 * 2. Attempts Gemini with exponential backoff (1s -> 2s -> 4s).
 * 3. On persistent 429 or quota limit, automatically falls back to Groq Cloud API (Mixtral 8x7b / Llama 3).
 * 4. If all providers fail or Groq key is absent, throws structured QuotaExceededError.
 */
export async function executeResilientContent(
  promptOrContents: string | GeminiContent[],
  options?: ResilientExecutionOptions
): Promise<ResilientExecutionResult> {
  const isMultimodal = isMultimodalContents(promptOrContents);
  const enableFallback = options?.enableFallback ?? true;
  let retryCount = 0;

  // Prompt length truncation to prevent HTTP 429 TPM exhaustion
  const maxPromptChars = options?.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const shouldTruncate = options?.truncatePrompt ?? true;

  let effectivePrompt = promptOrContents;
  if (typeof effectivePrompt === 'string' && shouldTruncate && effectivePrompt.length > maxPromptChars) {
    const truncated = truncatePromptForRateLimit(effectivePrompt, maxPromptChars);
    effectivePrompt = truncated.text;
  }

  // Handler for counting retries
  const handleRetry = (err: unknown, attempt: number, delayMs: number) => {
    retryCount = attempt;
    options?.onRetry?.(err, attempt, delayMs);
  };

  // 1. Multimodal execution path: Images require Gemini multimodal capabilities
  if (isMultimodal) {
    try {
      const result = await withExponentialBackoff(
        () => generateContent(effectivePrompt, options),
        {
          delays: options?.delays,
          maxRetries: options?.maxRetries,
          signal: options?.signal,
          onRetry: handleRetry,
        }
      );

      return {
        ...result,
        provider: 'gemini',
        usedFallback: false,
        retryAttempts: retryCount,
      };
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        const retryAfter = getRetryAfterSeconds(err);
        RateLimitTracker.recordRateLimit('gemini', retryAfter);
        throw new QuotaExceededError({
          message: formatQuotaBannerMessage(retryAfter),
          retryAfterSeconds: retryAfter,
          isMultimodal: true,
          provider: 'gemini',
          cause: err,
        });
      }
      throw err;
    }
  }

  // 2. Direct Groq execution if a Groq model was explicitly selected
  const isDirectGroqModel = typeof options?.model === 'string' &&
    (options.model.startsWith('qwen/') ||
     options.model.startsWith('openai/') ||
     options.model.startsWith('allam-') ||
     options.model.startsWith('llama-') ||
     options.model.startsWith('mixtral-') ||
     options.model.includes('groq'));

  if (isDirectGroqModel && !isMultimodal) {
    const groqKey = options?.groqApiKey?.trim() || (await getGroqApiKey());
    if (groqKey && groqKey.length >= 10) {
      const groqModel = options.model || DEFAULT_GROQ_MODEL;
      const groqResult = await generateGroqContent(effectivePrompt, {
        ...options,
        apiKey: groqKey,
        groqModel,
      });
      return {
        ...groqResult,
        provider: 'groq',
        usedFallback: false,
        retryAttempts: 0,
      };
    }
  }

  // 3. Text execution path: Gemini primary with automatic Groq Cloud fallback
  let geminiError: unknown = null;

  try {
    const result = await withExponentialBackoff(
      () => generateContent(effectivePrompt, options),
      {
        delays: options?.delays,
        maxRetries: options?.maxRetries,
        signal: options?.signal,
        onRetry: handleRetry,
      }
    );

    return {
      ...result,
      provider: 'gemini',
      usedFallback: false,
      retryAttempts: retryCount,
    };
  } catch (err: unknown) {
    if (options?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }

    if (!isRateLimitError(err)) {
      throw err;
    }

    geminiError = err;
    const retryAfter = getRetryAfterSeconds(err);
    RateLimitTracker.recordRateLimit('gemini', retryAfter);
  }

  // If fallback is disabled or query is multimodal, stop here
  if (!enableFallback) {
    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'gemini',
      cause: geminiError,
    });
  }

  // 3. Fallback to Groq Cloud API
  const groqKey = options?.groqApiKey?.trim() || (await getGroqApiKey());

  if (!groqKey || groqKey.length < 10) {
    // Groq key is not configured; render informative banner instruction
    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      message: formatQuotaBannerMessage(retryAfter),
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'gemini',
      cause: geminiError,
    });
  }

  const groqModel = options?.groqModel || DEFAULT_GROQ_MODEL;

  try {
    options?.onFallback?.('groq', `Gemini quota reached. Fallback to Groq (${groqModel}).`);

    const groqResult = await generateGroqContent(effectivePrompt, {
      ...options,
      apiKey: groqKey,
      groqModel,
    });

    return {
      ...groqResult,
      provider: 'groq',
      usedFallback: true,
      retryAttempts: retryCount,
      fallbackNotice: `Served via Groq (${groqModel}) fallback after Gemini rate limit`,
    };
  } catch (groqErr: unknown) {
    if (isRateLimitError(groqErr)) {
      RateLimitTracker.recordRateLimit('groq', getRetryAfterSeconds(groqErr));
    }

    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      message: `Gemini rate limit exceeded and Groq fallback failed: ${groqErr instanceof Error ? groqErr.message : String(groqErr)}`,
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'groq',
      cause: groqErr,
    });
  }
}

/**
 * Resilient Streaming AI Execution:
 * 1. Checks if multimodal; executes Gemini streaming with backoff.
 * 2. Attempts Gemini streaming with exponential backoff (1s -> 2s -> 4s).
 * 3. On 429 rate limit or quota exceeded, seamlessly falls back to Groq Cloud streaming.
 * 4. If all providers fail, throws structured QuotaExceededError.
 */
export async function streamResilientContent(
  promptOrContents: string | GeminiContent[],
  options?: ResilientExecutionOptions
): Promise<ResilientExecutionResult> {
  const isMultimodal = isMultimodalContents(promptOrContents);
  const enableFallback = options?.enableFallback ?? true;
  let retryCount = 0;

  // Prompt length truncation to prevent HTTP 429 TPM exhaustion
  const maxPromptChars = options?.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const shouldTruncate = options?.truncatePrompt ?? true;

  let effectivePrompt = promptOrContents;
  if (typeof effectivePrompt === 'string' && shouldTruncate && effectivePrompt.length > maxPromptChars) {
    const truncated = truncatePromptForRateLimit(effectivePrompt, maxPromptChars);
    effectivePrompt = truncated.text;
  }

  const handleRetry = (err: unknown, attempt: number, delayMs: number) => {
    retryCount = attempt;
    options?.onRetry?.(err, attempt, delayMs);
  };

  // 1. Multimodal path
  if (isMultimodal) {
    try {
      const result = await withExponentialBackoff(
        () => streamGenerateContent(effectivePrompt, options),
        {
          delays: options?.delays,
          maxRetries: options?.maxRetries,
          signal: options?.signal,
          onRetry: handleRetry,
        }
      );

      return {
        ...result,
        provider: 'gemini',
        usedFallback: false,
        retryAttempts: retryCount,
      };
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        const retryAfter = getRetryAfterSeconds(err);
        RateLimitTracker.recordRateLimit('gemini', retryAfter);
        throw new QuotaExceededError({
          message: formatQuotaBannerMessage(retryAfter),
          retryAfterSeconds: retryAfter,
          isMultimodal: true,
          provider: 'gemini',
          cause: err,
        });
      }
      throw err;
    }
  }

  // 2. Direct Groq streaming if a Groq model was explicitly selected
  const isDirectGroqModel = typeof options?.model === 'string' &&
    (options.model.startsWith('qwen/') ||
     options.model.startsWith('openai/') ||
     options.model.startsWith('allam-') ||
     options.model.startsWith('llama-') ||
     options.model.startsWith('mixtral-') ||
     options.model.includes('groq'));

  if (isDirectGroqModel && !isMultimodal) {
    const groqKey = options?.groqApiKey?.trim() || (await getGroqApiKey());
    if (groqKey && groqKey.length >= 10) {
      const groqModel = options.model || DEFAULT_GROQ_MODEL;
      const groqResult = await streamGroqContent(effectivePrompt, {
        ...options,
        apiKey: groqKey,
        groqModel,
      });
      return {
        ...groqResult,
        provider: 'groq',
        usedFallback: false,
        retryAttempts: 0,
      };
    }
  }

  // 3. Text streaming: Gemini primary
  let geminiError: unknown = null;
  let chunkEmitted = false;

  // Wrap user onChunk to know if tokens were emitted before error
  const trackingOnChunk: StreamOptions['onChunk'] = (delta, accumulated) => {
    chunkEmitted = true;
    options?.onChunk?.(delta, accumulated);
  };

  try {
    const result = await withExponentialBackoff(
      () =>
        streamGenerateContent(effectivePrompt, {
          ...options,
          onChunk: trackingOnChunk,
        }),
      {
        delays: options?.delays,
        maxRetries: options?.maxRetries,
        signal: options?.signal,
        onRetry: handleRetry,
      }
    );

    return {
      ...result,
      provider: 'gemini',
      usedFallback: false,
      retryAttempts: retryCount,
    };
  } catch (err: unknown) {
    if (options?.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }

    if (!isRateLimitError(err)) {
      throw err;
    }

    geminiError = err;
    const retryAfter = getRetryAfterSeconds(err);
    RateLimitTracker.recordRateLimit('gemini', retryAfter);
  }

  if (!enableFallback) {
    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'gemini',
      cause: geminiError,
    });
  }

  // 3. Fallback to Groq Cloud streaming
  const groqKey = options?.groqApiKey?.trim() || (await getGroqApiKey());

  if (!groqKey || groqKey.length < 10) {
    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      message: formatQuotaBannerMessage(retryAfter),
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'gemini',
      cause: geminiError,
    });
  }

  const groqModel = options?.groqModel || DEFAULT_GROQ_MODEL;

  try {
    options?.onFallback?.('groq', `Gemini quota reached. Fallback streaming via Groq (${groqModel}).`);

    const groqResult = await streamGroqContent(effectivePrompt, {
      ...options,
      apiKey: groqKey,
      groqModel,
      onChunk: options?.onChunk,
    });

    return {
      ...groqResult,
      provider: 'groq',
      usedFallback: true,
      retryAttempts: retryCount,
      fallbackNotice: `Streamed via Groq (${groqModel}) fallback after Gemini rate limit`,
    };
  } catch (groqErr: unknown) {
    if (isRateLimitError(groqErr)) {
      RateLimitTracker.recordRateLimit('groq', getRetryAfterSeconds(groqErr));
    }

    const retryAfter = getRetryAfterSeconds(geminiError);
    throw new QuotaExceededError({
      message: `Gemini rate limit exceeded and Groq fallback streaming failed: ${groqErr instanceof Error ? groqErr.message : String(groqErr)}`,
      retryAfterSeconds: retryAfter,
      isMultimodal: false,
      provider: 'groq',
      cause: groqErr,
    });
  }
}

