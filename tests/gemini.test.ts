import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateContent,
  streamGenerateContent,
  buildSummarizationSystemInstruction,
  wrapUntrustedContent,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
  generateStructuredSummary,
  GeminiError,
  normalizeModelName,
} from '../src/services/ai/gemini.ts';

// Setup minimal chrome mock for test environment
if (typeof globalThis.chrome === 'undefined') {
  const memoryStore: Record<string, any> = {
    askbro_settings: {
      geminiApiKey: 'AIzaSyFakeKeyForTesting1234567890',
      model: 'gemini-1.5-flash-lite',
      language: 'en',
    },
  };

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: memoryStore[key] }),
        set: async (items: Record<string, any>) => Object.assign(memoryStore, items),
        remove: async (key: string) => delete memoryStore[key],
      },
      session: {
        get: async (key: string) => ({ [key]: memoryStore[key] }),
        set: async (items: Record<string, any>) => Object.assign(memoryStore, items),
      },
    },
  };
}

test('Gemini Client Service - Model Name Normalization', () => {
  assert.equal(normalizeModelName('models/gemini-1.5-flash-lite'), 'gemini-1.5-flash-lite');
  assert.equal(normalizeModelName('gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeModelName('  gemini-2.0-flash  '), 'gemini-3.8-flash');
  assert.equal(normalizeModelName('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeModelName('models/gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeModelName('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
  assert.equal(normalizeModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('Gemini Client Service - System Instruction Construction', () => {
  const enInstruction = buildSummarizationSystemInstruction('en');
  assert.ok(enInstruction.includes('TL;DR'), 'Should contain TL;DR section requirement');
  assert.ok(enInstruction.includes('5 Key Takeaways'), 'Should contain 5 Key Takeaways requirement');
  assert.ok(enInstruction.includes('What To Do Next'), 'Should contain What To Do Next requirement');
  assert.ok(
    enInstruction.includes('<untrusted_webpage_content>'),
    'Should include untrusted content containment instructions'
  );

  const hinglishInstruction = buildSummarizationSystemInstruction('hinglish');
  assert.ok(hinglishInstruction.includes('Hinglish'), 'Should reference Hinglish');
  assert.ok(hinglishInstruction.includes('Roman/Latin script'), 'Should require Roman/Latin script');
  assert.ok(hinglishInstruction.includes('TL;DR'), 'Should contain TL;DR section requirement in Hinglish');
});

test('Gemini Client Service - Prompt Wrapping & Sanitization', () => {
  const wrapped = wrapUntrustedContent(
    'This is an article about quantum computing.',
    'Quantum Intro',
    'https://example.com/quantum'
  );

  assert.ok(wrapped.includes('<untrusted_webpage_content>'), 'Should open XML delimiter');
  assert.ok(wrapped.includes('</untrusted_webpage_content>'), 'Should close XML delimiter');
  assert.ok(wrapped.includes('Page Title: Quantum Intro'), 'Should include title');
  assert.ok(wrapped.includes('URL: https://example.com/quantum'), 'Should include URL');
  assert.ok(wrapped.includes('quantum computing'), 'Should include body content');
});

test('Gemini Client Service - Resilient Summary Markdown Parsing', () => {
  const sampleMarkdown = `### 1. TL;DR
Quantum computing leverages quantum mechanical phenomena to solve complex problems exponentially faster than classical computers.

### 2. 5 Key Takeaways
- **Superposition Advantage**: Qubits can exist in multiple states simultaneously, enabling massive parallelism.
- **Entanglement**: Entangled qubits coordinate instantaneously regardless of physical separation.
- **Error Mitigation**: Modern quantum systems rely on surface codes and topological protection against decoherence.
- **Commercial Applications**: Near-term breakthroughs are expected in molecular simulation and cryptography.
- **Hardware Diversity**: Superconducting circuits, trapped ions, and neutral atoms represent competing architectures.

### 3. What To Do Next
- Explore quantum programming using Qiskit or Cirq.
- Review post-quantum cryptographic standards published by NIST.`;

  const parsed = parseStructuredSummary(sampleMarkdown);

  assert.ok(parsed.tldr.includes('Quantum computing leverages'));
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.ok(parsed.keyTakeaways[0].includes('Superposition Advantage'));
  assert.ok(parsed.keyTakeaways[4].includes('Hardware Diversity'));
  assert.equal(parsed.actionableSteps.length, 2);
  assert.ok(parsed.actionableSteps[0].includes('Qiskit or Cirq'));

  const canonicalMarkdown = formatSummaryAsMarkdown(parsed);
  assert.ok(canonicalMarkdown.startsWith('### 1. TL;DR'));
  assert.ok(canonicalMarkdown.includes('### 2. 5 Key Takeaways'));
  assert.ok(canonicalMarkdown.includes('### 3. What To Do Next'));
});

test('Gemini Client Service - Fallback Parsing for Non-Standard Formatting', () => {
  const awkwardOutput = `Here is the summary of the page:
Quantum computing is moving fast today.
* First point about qubits.
* Second point about algorithms.
* Third point about decoherence.
Follow up by reading documentation.`;

  const parsed = parseStructuredSummary(awkwardOutput);
  assert.ok(parsed.tldr.length > 0, 'Should extract a fallback TL;DR');
  assert.ok(parsed.keyTakeaways.length >= 3, 'Should extract bullet points');
  assert.ok(parsed.actionableSteps.length > 0, 'Should provide actionable fallback');
});

test('Gemini Client Service - Non-Streaming generateContent Call', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let capturedUrl = '';
    let capturedBody: any = null;

    globalThis.fetch = async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '### 1. TL;DR\nTest TLDR\n\n### 2. 5 Key Takeaways\n- **Point 1**: Detail\n\n### 3. What To Do Next\n- Action' }],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 30,
            totalTokenCount: 45,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const result = await generateContent('Summarize this test content', {
      apiKey: 'test-api-key-1234567890',
      model: 'gemini-1.5-flash-lite',
    });

    assert.ok(capturedUrl.includes('models/gemini-1.5-flash-lite:generateContent'));
    assert.ok(capturedUrl.includes('key=test-api-key-1234567890'));
    assert.equal(capturedBody.contents[0].parts[0].text, 'Summarize this test content');
    assert.ok(result.text.includes('### 1. TL;DR'));
    assert.equal(result.finishReason, 'STOP');
    assert.equal(result.usage?.totalTokenCount, 45);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini Client Service - SSE Streaming streamGenerateContent Call', async () => {
  const originalFetch = globalThis.fetch;

  try {
    let capturedUrl = '';
    const chunksReceived: string[] = [];
    let lastAccumulated = '';

    // Mock an SSE stream
    const ssePayload = [
      'data: {"candidates":[{"content":{"parts":[{"text":"### 1. TL;DR\\n"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Streaming works seamlessly.\\n\\n"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"### 2. 5 Key Takeaways\\n- **Fast**: High speed.\\n"}]}}],"usageMetadata":{"totalTokenCount":60}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    globalThis.fetch = async (url: any) => {
      capturedUrl = String(url);
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

    const result = await streamGenerateContent('Test stream', {
      apiKey: 'test-api-key-1234567890',
      model: 'gemini-1.5-flash-lite',
      onChunk: (delta, accumulated) => {
        chunksReceived.push(delta);
        lastAccumulated = accumulated;
      },
    });

    assert.ok(capturedUrl.includes('streamGenerateContent?alt=sse'));
    assert.ok(chunksReceived.length >= 3, 'Should have received multiple stream chunks');
    assert.equal(lastAccumulated, result.text);
    assert.ok(result.text.includes('Streaming works seamlessly'));
    assert.equal(result.usage?.totalTokenCount, 60);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini Client Service - Error Classification & Quota Limit (HTTP 429)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Resource has been exhausted (check quota).',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => {
        await generateContent('test prompt', {
          apiKey: 'test-api-key-1234567890',
        });
      },
      (err: any) => {
        assert.ok(err instanceof GeminiError);
        assert.equal(err.status, 429);
        assert.equal(err.isRateLimit, true);
        assert.ok(err.message.includes('rate limit or quota exceeded'));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini Client Service - Error Classification & Invalid Key (HTTP 400)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => {
        await generateContent('test prompt', {
          apiKey: 'invalid-key-1234567890',
        });
      },
      (err: any) => {
        assert.ok(err instanceof GeminiError);
        assert.equal(err.status, 400);
        assert.equal(err.isAuthError, true);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini Client Service - Full generateStructuredSummary Flow', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      assert.ok(body.systemInstruction.parts[0].text.includes('Hinglish'));

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `### 1. TL;DR
Yeh tool browser automation ko asaan aur controlled banata hai bina kisi privacy risk ke.

### 2. 5 Key Takeaways
- **Local First**: Sabhi keys user ki machine par store hoti hain.
- **Strict Approval**: Har computer action par pehle user permission maangi jaati hai.
- **Fast Models**: Gemini Flash-Lite quick summaries provide karta hai.
- **Hinglish Mode**: Students ke liye simple bhasha mein notes available hain.
- **Safety Rails**: Password aur bank details automatically block ho jaati hain.

### 3. What To Do Next
- Extension ko install karke settings open karein.
- Ek test page par summary check karein.`,
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const result = await generateStructuredSummary({
      content: 'ASKbro is a Chrome sidepanel agent.',
      title: 'ASKbro Overview',
      url: 'https://askbro.dev',
      language: 'hinglish',
      apiKey: 'test-api-key-1234567890',
    });

    assert.equal(result.language, 'hinglish');
    assert.ok(result.summary.tldr.includes('Yeh tool browser automation'));
    assert.equal(result.summary.keyTakeaways.length, 5);
    assert.ok(result.summary.keyTakeaways[0].includes('Local First'));
    assert.equal(result.summary.actionableSteps.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

