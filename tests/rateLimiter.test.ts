/**
 * Automated Unit Tests for Slice 2.4: Free-Tier Resilience & Fallback Engine
 *
 * Verifies:
 * - HTTP 429 / Quota Exceeded error detection
 * - Exponential backoff retry mechanism (1s -> 2s -> 4s)
 * - Groq Cloud API payload conversion and REST caller
 * - Groq SSE stream parsing
 * - Automatic Groq fallback on Gemini rate limits (Mixtral 8x7b / Llama 3)
 * - Multimodal quota guard (no invalid text fallback for screenshots)
 * - QuotaExceededError and informative banner text formatting:
 *   "Daily free-tier quota reached. Retry in X seconds or configure fallback key."
 * - RateLimitTracker cooldown management
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRateLimitError,
  getRetryAfterSeconds,
  formatQuotaBannerMessage,
  QuotaExceededError,
  RateLimitTracker,
  sleep,
  withExponentialBackoff,
  executeResilientContent,
  streamResilientContent,
  DEFAULT_BACKOFF_DELAYS,
} from '../src/services/ai/rateLimiter';
import {
  GroqError,
  convertGeminiToGroqMessages,
  isMultimodalContents,
  generateGroqContent,
  streamGroqContent,
  GROQ_API_BASE_URL,
} from '../src/services/ai/groq';
import { GeminiError } from '../src/services/ai/gemini';
import {
  DEFAULT_GROQ_MODEL,
  GROQ_MIXTRAL_MODEL,
  GROQ_LLAMA_70B_MODEL,
  GeminiContent,
} from '../src/types/ai';

// Mock chrome.storage for tests
(globalThis as any).chrome = {
  storage: {
    local: {
      get: (_keys: any, cb?: (res: any) => void) => {
        const res = {};
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      set: (_items: any, cb?: () => void) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
      remove: (_keys: any, cb?: () => void) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
    },
  },
};

test('Slice 2.4 - Rate Limit Error Detection (isRateLimitError)', () => {
  // 1. Direct status code
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError({ status: 200 }), false);
  assert.equal(isRateLimitError({ status: 500 }), false);

  // 2. GeminiError & GroqError instances
  const gemini429 = new GeminiError('Resource exhausted', { status: 429 });
  assert.equal(isRateLimitError(gemini429), true);
  assert.equal(gemini429.isRateLimit, true);

  const groq429 = new GroqError('Tokens per minute limit reached', { status: 429 });
  assert.equal(isRateLimitError(groq429), true);
  assert.equal(groq429.isRateLimit, true);

  // 3. String error messages
  assert.equal(isRateLimitError(new Error('Quota exceeded for quota metric')), true);
  assert.equal(isRateLimitError(new Error('RESOURCE_EXHAUSTED')), true);
  assert.equal(isRateLimitError(new Error('Rate limit exceeded: 429 Too Many Requests')), true);
  assert.equal(isRateLimitError(new Error('rate_limit_exceeded')), true);
  assert.equal(isRateLimitError(new Error('Too many requests')), true);

  // 4. Non-rate-limit errors
  assert.equal(isRateLimitError(new Error('Network connection aborted')), false);
  assert.equal(isRateLimitError(new Error('Invalid API key')), false);
  assert.equal(isRateLimitError(null), false);
  assert.equal(isRateLimitError(undefined), false);
});

test('Slice 2.4 - Retry-After Calculation & Banner Formatting', () => {
  // Regex extraction from message strings
  assert.equal(getRetryAfterSeconds(new Error('Please retry after 18 seconds')), 18);
  assert.equal(getRetryAfterSeconds(new Error('Resource exhausted: wait 42s before trying again')), 42);
  assert.equal(getRetryAfterSeconds(new Error('Try again in 12.5 seconds')), 13);

  // Explicit retryAfterSeconds property
  assert.equal(getRetryAfterSeconds({ retryAfterSeconds: 25 }), 25);

  // Fallback to default when no number is given
  assert.equal(getRetryAfterSeconds(new Error('Rate limit exceeded'), 30), 30);

  // Banner message format matches Slice 2.4 specification exactly
  const banner = formatQuotaBannerMessage(30);
  assert.equal(
    banner,
    'Daily free-tier quota reached. Retry in 30 seconds or configure fallback key.'
  );

  const banner42 = formatQuotaBannerMessage(42);
  assert.equal(
    banner42,
    'Daily free-tier quota reached. Retry in 42 seconds or configure fallback key.'
  );
});

test('Slice 2.4 - QuotaExceededError Structure & Backward Compatibility', () => {
  const err = new QuotaExceededError({
    retryAfterSeconds: 45,
    isMultimodal: true,
    provider: 'gemini',
  });

  // Verify backward compatibility with GeminiError checks
  assert.ok(err instanceof GeminiError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'QuotaExceededError');
  assert.equal(err.status, 429);
  assert.equal(err.isRateLimit, true);
  assert.equal(err.retryAfterSeconds, 45);
  assert.equal(err.isMultimodal, true);
  assert.equal(err.provider, 'gemini');
  assert.equal(
    err.bannerMessage,
    'Daily free-tier quota reached. Retry in 45 seconds or configure fallback key.'
  );
});

test('Slice 2.4 - RateLimitTracker Cooldown Lifecycle', () => {
  RateLimitTracker.clearCooldown();
  assert.equal(RateLimitTracker.isRateLimited('gemini'), false);
  assert.equal(RateLimitTracker.getCooldownRemainingSeconds('gemini'), 0);

  // Record rate limit for Gemini with 20 seconds cooldown
  RateLimitTracker.recordRateLimit('gemini', 20);
  assert.equal(RateLimitTracker.isRateLimited('gemini'), true);
  assert.ok(RateLimitTracker.getCooldownRemainingSeconds('gemini') > 15);

  // Status diagnostics
  const status = RateLimitTracker.getStatus('gemini');
  assert.equal(status.isRateLimited, true);
  assert.equal(status.provider, 'gemini');
  assert.ok(status.bannerMessage.includes('Daily free-tier quota reached'));

  // Clearing cooldown resets state
  RateLimitTracker.clearCooldown('gemini');
  assert.equal(RateLimitTracker.isRateLimited('gemini'), false);
  assert.equal(RateLimitTracker.getCooldownRemainingSeconds('gemini'), 0);
});

test('Slice 2.4 - Sleep Helper & AbortSignal Support', async () => {
  const start = performance.now();
  await sleep(20);
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 15, 'Should sleep for at least ~15ms');

  // Test AbortSignal aborts sleep immediately
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    async () => {
      await sleep(1000, controller.signal);
    },
    (err: any) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

test('Slice 2.4 - Exponential Backoff Retries (1s -> 2s -> 4s Sequence)', async () => {
  assert.deepEqual(DEFAULT_BACKOFF_DELAYS, [1000, 2000, 4000]);

  // Test retry on HTTP 429 succeeding on 3rd attempt
  const retryLog: Array<{ attempt: number; delayMs: number }> = [];
  let callCount = 0;

  const result = await withExponentialBackoff(
    async (attempt) => {
      callCount++;
      if (callCount < 3) {
        throw new GeminiError('Rate limit exceeded', { status: 429 });
      }
      return `Success on attempt ${attempt}`;
    },
    {
      delays: [10, 20, 40], // Fast test intervals
      maxRetries: 3,
      onRetry: (_err, attempt, delayMs) => {
        retryLog.push({ attempt, delayMs });
      },
    }
  );

  assert.equal(result, 'Success on attempt 3');
  assert.equal(callCount, 3);
  assert.equal(retryLog.length, 2);
  assert.equal(retryLog[0].attempt, 1);
  assert.equal(retryLog[0].delayMs, 10);
  assert.equal(retryLog[1].attempt, 2);
  assert.equal(retryLog[1].delayMs, 20);
});

test('Slice 2.4 - Exponential Backoff Throws when All Retries Fail', async () => {
  let callCount = 0;

  await assert.rejects(
    async () => {
      await withExponentialBackoff(
        async () => {
          callCount++;
          throw new GeminiError('Resource exhausted (HTTP 429)', { status: 429 });
        },
        {
          delays: [5, 10],
          maxRetries: 2,
        }
      );
    },
    (err: any) => {
      assert.ok(err instanceof GeminiError);
      assert.equal(err.status, 429);
      return true;
    }
  );

  // Initial attempt (1) + 2 retries = 3 calls
  assert.equal(callCount, 3);
});

test('Slice 2.4 - Exponential Backoff Does NOT Retry Non-Rate-Limit Errors', async () => {
  let callCount = 0;

  await assert.rejects(
    async () => {
      await withExponentialBackoff(
        async () => {
          callCount++;
          throw new GeminiError('Invalid API key', { status: 400 });
        },
        {
          delays: [5, 10],
          maxRetries: 2,
        }
      );
    },
    (err: any) => {
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Failed immediately without retrying
  assert.equal(callCount, 1);
});

test('Slice 2.4 - Gemini to Groq Payload Conversion & Multimodal Guard', () => {
  // 1. Plain string prompt
  const msgs1 = convertGeminiToGroqMessages('Hello Groq');
  assert.deepEqual(msgs1, [{ role: 'user', content: 'Hello Groq' }]);

  // 2. System instruction + Gemini content history
  const history: GeminiContent[] = [
    { role: 'user', parts: [{ text: 'What is Web3?' }] },
    { role: 'model', parts: [{ text: 'Web3 refers to decentralized web.' }] },
    { role: 'user', parts: [{ text: 'Explain more.' }] },
  ];

  const msgs2 = convertGeminiToGroqMessages(history, 'You are ASKbro assistant.');
  assert.equal(msgs2.length, 4);
  assert.deepEqual(msgs2[0], { role: 'system', content: 'You are ASKbro assistant.' });
  assert.deepEqual(msgs2[1], { role: 'user', content: 'What is Web3?' });
  assert.deepEqual(msgs2[2], { role: 'assistant', content: 'Web3 refers to decentralized web.' });
  assert.deepEqual(msgs2[3], { role: 'user', content: 'Explain more.' });

  // 3. Multimodal detection
  assert.equal(isMultimodalContents('Text only'), false);
  assert.equal(isMultimodalContents(history), false);

  const multimodalPayload: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        { text: 'Analyze this chart' },
        { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } },
      ],
    },
  ];

  assert.equal(isMultimodalContents(multimodalPayload), true);
});

test('Slice 2.4 - Groq Cloud Non-Streaming Execution (generateGroqContent)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedAuth = '';

    globalThis.fetch = async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedAuth = init?.headers?.Authorization || '';
      capturedBody = JSON.parse(init?.body || '{}');

      const mockResponse = {
        id: 'chatcmpl-test-123',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '### TL;DR\nGroq Cloud fallback executed rapidly with Mixtral 8x7b.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 45,
          completion_tokens: 22,
          total_tokens: 67,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await generateGroqContent('Test prompt for Groq', {
      apiKey: 'gsk_mock_groq_key_1234567890',
      groqModel: GROQ_MIXTRAL_MODEL,
    });

    assert.equal(capturedUrl, GROQ_API_BASE_URL);
    assert.equal(capturedAuth, 'Bearer gsk_mock_groq_key_1234567890');
    assert.equal(capturedBody.model, GROQ_MIXTRAL_MODEL);
    assert.ok(result.text.includes('Groq Cloud fallback executed rapidly'));
    assert.equal(result.usage?.totalTokenCount, 67);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.4 - Groq Cloud SSE Streaming Execution (streamGroqContent)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Groq "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"streaming "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"works flawlessly!"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    globalThis.fetch = async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const chunks: string[] = [];
    let lastAccumulated = '';

    const result = await streamGroqContent('Stream prompt', {
      apiKey: 'gsk_mock_groq_key_1234567890',
      groqModel: GROQ_LLAMA_70B_MODEL,
      onChunk: (delta, accumulated) => {
        chunks.push(delta);
        lastAccumulated = accumulated;
      },
    });

    assert.equal(chunks.length, 3);
    assert.equal(result.text, 'Groq streaming works flawlessly!');
    assert.equal(lastAccumulated, result.text);
    assert.equal(result.finishReason, 'stop');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.4 - Acceptance Criteria: Forcing an HTTP 429 response triggers retry and automatic Groq fallback without UI crashes', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let geminiAttempts = 0;
    let groqCalled = false;
    let fallbackNoticeReceived = '';

    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);

      // Gemini Endpoint hits HTTP 429
      if (urlStr.includes('googleapis.com')) {
        geminiAttempts++;
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Resource exhausted: rate limit exceeded. Please retry after 30s.',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Groq Endpoint succeeds with Mixtral 8x7b
      if (urlStr.includes('groq.com')) {
        groqCalled = true;
        const mockGroqResponse = {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Grounded answer successfully retrieved via Groq Cloud fallback.',
              },
              finish_reason: 'stop',
            },
          ],
        };

        return new Response(JSON.stringify(mockGroqResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    };

    // Execute through resilient engine
    const result = await executeResilientContent('What is the main point of this article?', {
      apiKey: 'test-gemini-key-1234567890',
      groqApiKey: 'gsk_test_groq_key_1234567890',
      groqModel: GROQ_MIXTRAL_MODEL,
      delays: [5, 10, 15], // Fast retry intervals for test
      maxRetries: 3,
      onFallback: (_provider, reason) => {
        fallbackNoticeReceived = reason;
      },
    });

    // 1. Gemini retried 3 times (1 initial + 3 retries = 4 attempts)
    assert.equal(geminiAttempts, 4);

    // 2. Groq was automatically triggered
    assert.equal(groqCalled, true);

    // 3. Output is clean, non-crashing, and marked as Groq fallback
    assert.equal(result.provider, 'groq');
    assert.equal(result.usedFallback, true);
    assert.ok(result.text.includes('Grounded answer successfully retrieved via Groq Cloud fallback'));
    assert.ok(fallbackNoticeReceived.includes('Gemini quota reached'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.4 - Acceptance Criteria: Streaming HTTP 429 triggers retry and automatic Groq streaming fallback', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let geminiAttempts = 0;
    let groqStreamCalled = false;
    const streamedDeltas: string[] = [];

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);

      if (urlStr.includes('googleapis.com')) {
        geminiAttempts++;
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Gemini free-tier quota exceeded.',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('groq.com')) {
        groqStreamCalled = true;
        const sseStream = [
          'data: {"choices":[{"delta":{"content":"Groq "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"streaming fallback works!"}}]}\n\n',
          'data: [DONE]\n\n',
        ].join('');

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseStream));
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return new Response('Not Found', { status: 404 });
    };

    const result = await streamResilientContent('Explain quantum computing', {
      apiKey: 'test-gemini-key-1234567890',
      groqApiKey: 'gsk_test_groq_key_1234567890',
      delays: [5, 10],
      maxRetries: 2,
      onChunk: (delta) => {
        streamedDeltas.push(delta);
      },
    });

    assert.equal(geminiAttempts, 3);
    assert.equal(groqStreamCalled, true);
    assert.equal(result.provider, 'groq');
    assert.equal(result.usedFallback, true);
    assert.equal(result.text, 'Groq streaming fallback works!');
    assert.deepEqual(streamedDeltas, ['Groq ', 'streaming fallback works!']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.4 - Quota Exceeded Without Groq Key Renders Informative Banner Message', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Resource exhausted: retry after 25 seconds.',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await assert.rejects(
      async () => {
        await executeResilientContent('Summarize this page', {
          apiKey: 'test-gemini-key-1234567890',
          groqApiKey: '', // No Groq key configured
          delays: [5],
          maxRetries: 1,
        });
      },
      (err: any) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.equal(err.status, 429);
        assert.equal(err.retryAfterSeconds, 25);
        assert.equal(
          err.bannerMessage,
          'Daily free-tier quota reached. Retry in 25 seconds or configure fallback key.'
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.4 - Multimodal Payload Rate Limit Throws with isMultimodal Flag and Does Not Fallback to Text Groq', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let groqWasCalled = false;

    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('groq.com')) {
        groqWasCalled = true;
      }

      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Rate limit exceeded for multimodal model.',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const multimodalPayload: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          { text: 'Diagnose this error screenshot' },
          { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } },
        ],
      },
    ];

    await assert.rejects(
      async () => {
        await executeResilientContent(multimodalPayload, {
          apiKey: 'test-gemini-key-1234567890',
          groqApiKey: 'gsk_test_groq_key_1234567890',
          delays: [5],
          maxRetries: 1,
        });
      },
      (err: any) => {
        assert.ok(err instanceof QuotaExceededError);
        assert.equal(err.isMultimodal, true);
        assert.ok(err.bannerMessage.includes('Daily free-tier quota reached'));
        return true;
      }
    );

    // Verified: Multimodal queries never attempt text-only Groq fallback
    assert.equal(groqWasCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
