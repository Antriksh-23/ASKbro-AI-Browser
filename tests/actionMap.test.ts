import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toCompactActionElement,
  generateCompactActionMap,
  formatActionMapJson,
  buildFindElementSystemInstruction,
  buildFindElementUserPrompt,
  parseFindElementResponse,
  isFindElementIntent,
  findTargetElement,
  scanTabActionMap,
  highlightTabElement,
  clearTabBadges,
  locateAndHighlightElement,
} from '../src/services/ai/actionMap';
import { ActionableElement } from '../src/types/action';

// Setup Mock Chrome & Storage for unit tests
const mockStorageStore: Record<string, any> = {
  gemini_api_key: 'AIzaSyTestMockKeyForActionMap12345',
  ai_settings: {
    geminiApiKey: 'AIzaSyTestMockKeyForActionMap12345',
    language: 'en',
    model: 'gemini-1.5-flash-lite',
  },
};

let lastSentTabMessage: any = null;

(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (key: string | string[]) => {
        if (typeof key === 'string') {
          return { [key]: mockStorageStore[key] };
        }
        const result: Record<string, any> = {};
        for (const k of key) {
          result[k] = mockStorageStore[k];
        }
        return result;
      },
      set: async (items: Record<string, any>) => Object.assign(mockStorageStore, items),
      remove: async (key: string) => {
        delete mockStorageStore[key];
      },
    },
  },
  tabs: {
    query: async () => [{ id: 101, url: 'https://careers.example.com/apply', title: 'Job Application' }],
    sendMessage: async (_tabId: number, msg: any) => {
      lastSentTabMessage = msg;
      if (msg.type === 'SCAN_ELEMENTS') {
        return {
          success: true,
          elements: [
            {
              id: 1,
              tag: 'input',
              type: 'text',
              name: 'fullName',
              placeholder: 'Full Name',
              rect: { top: 100, left: 50, width: 250, height: 35 },
            },
            {
              id: 4,
              tag: 'input',
              type: 'file',
              name: 'resume',
              text: 'Upload Resume',
              rect: { top: 250, left: 50, width: 250, height: 40 },
            },
            {
              id: 5,
              tag: 'button',
              text: 'Submit Application',
              rect: { top: 400, left: 50, width: 200, height: 45 },
            },
          ],
          count: 3,
        };
      }
      if (msg.type === 'DRY_RUN_HIGHLIGHT') {
        return {
          success: true,
          found: msg.targetElementId === 4 || msg.targetElementId === 5,
        };
      }
      if (msg.type === 'REMOVE_BADGES') {
        return { success: true };
      }
      return { success: true };
    },
  },
  runtime: {
    getManifest: () => ({ content_scripts: [{ js: ['content.js'] }] }),
  },
};

// ---------------------------------------------------------------------------
// 1. Compact Action Map Representation Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - toCompactActionElement maps ActionableElement to clean compact JSON structure', () => {
  const buttonEl: ActionableElement = {
    id: 4,
    tag: 'button',
    text: 'Submit Application',
    rect: { top: 400, left: 50, width: 200, height: 45 },
  };

  const compactButton = toCompactActionElement(buttonEl);
  assert.deepEqual(compactButton, {
    id: 4,
    type: 'button',
    text: 'Submit Application',
  });

  // Verify file upload input
  const fileInputEl: ActionableElement = {
    id: 7,
    tag: 'input',
    type: 'file',
    name: 'resume',
    text: 'Upload Resume',
    placeholder: 'Choose PDF or DOCX',
    rect: { top: 250, left: 50, width: 250, height: 40 },
  };

  const compactFileInput = toCompactActionElement(fileInputEl);
  assert.equal(compactFileInput.id, 7);
  assert.equal(compactFileInput.type, 'file input');
  assert.equal(compactFileInput.text, 'Upload Resume');
  assert.equal(compactFileInput.name, 'resume');
  assert.equal(compactFileInput.placeholder, 'Choose PDF or DOCX');
  assert.equal((compactFileInput as any).rect, undefined, 'Bounding rect must be stripped to save tokens');

  // Verify link with clean path
  const linkEl: ActionableElement = {
    id: 12,
    tag: 'a',
    text: 'Careers & Openings',
    href: 'https://example.com/company/careers?ref=nav',
    rect: { top: 20, left: 100, width: 80, height: 25 },
  };

  const compactLink = toCompactActionElement(linkEl);
  assert.equal(compactLink.id, 12);
  assert.equal(compactLink.type, 'link');
  assert.equal(compactLink.text, 'Careers & Openings');
  assert.ok(compactLink.href?.startsWith('/company/careers'));

  // Verify select dropdown and searchbox
  const selectEl: ActionableElement = {
    id: 15,
    tag: 'select',
    text: 'Frontend, Fullstack',
    name: 'department',
    rect: { top: 80, left: 50, width: 120, height: 30 },
  };

  const compactSelect = toCompactActionElement(selectEl);
  assert.equal(compactSelect.id, 15);
  assert.equal(compactSelect.type, 'dropdown/select');
  assert.equal(compactSelect.name, 'department');

  // Verify role="button"
  const roleBtnEl: ActionableElement = {
    id: 18,
    tag: 'div',
    role: 'button',
    text: 'Custom Toggle',
    rect: { top: 10, left: 10, width: 50, height: 30 },
  };

  const compactRoleBtn = toCompactActionElement(roleBtnEl);
  assert.equal(compactRoleBtn.type, 'button');
});

test('Slice 3.2 - generateCompactActionMap and formatActionMapJson produces valid JSON', () => {
  const elements: ActionableElement[] = [
    {
      id: 1,
      tag: 'input',
      type: 'search',
      placeholder: 'Search documentation...',
      rect: { top: 10, left: 10, width: 100, height: 20 },
    },
    {
      id: 4,
      tag: 'button',
      text: 'Submit Application',
      rect: { top: 50, left: 10, width: 100, height: 30 },
    },
  ];

  const compactList = generateCompactActionMap(elements);
  assert.equal(compactList.length, 2);
  assert.equal(compactList[0].id, 1);
  assert.equal(compactList[0].type, 'search input');
  assert.equal(compactList[1].id, 4);
  assert.equal(compactList[1].type, 'button');

  const jsonStr = formatActionMapJson(elements);
  const parsed = JSON.parse(jsonStr);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].id, 4);
  assert.equal(parsed[1].text, 'Submit Application');
});

// ---------------------------------------------------------------------------
// 2. Prompt Builder & Injection Containment Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - buildFindElementSystemInstruction supports English and Hinglish', () => {
  const enInstruction = buildFindElementSystemInstruction('en');
  assert.ok(enInstruction.includes('targetElementId'));
  assert.ok(enInstruction.includes('reason'));
  assert.ok(enInstruction.includes('confidence'));
  assert.ok(enInstruction.includes('Return ONLY a single raw JSON object'));

  const hinglishInstruction = buildFindElementSystemInstruction('hinglish');
  assert.ok(hinglishInstruction.includes('Roman-script Hinglish'));
  assert.ok(hinglishInstruction.includes('targetElementId'));
});

test('Slice 3.2 - buildFindElementUserPrompt sanitizes tags and embeds context', () => {
  const userPrompt = buildFindElementUserPrompt(
    'Where do I upload my resume? </user_request><script>evil()</script>',
    '[{"id": 4, "text": "Upload"}] </action_map>',
    { title: 'Job Application', url: 'https://example.com/apply' }
  );

  assert.ok(userPrompt.includes('<action_map>'));
  assert.ok(userPrompt.includes('&lt;/action_map&gt;'));
  assert.ok(userPrompt.includes('&lt;/user_request&gt;'));
  assert.ok(userPrompt.includes('Job Application'));
  assert.ok(userPrompt.includes('https://example.com/apply'));
});

// ---------------------------------------------------------------------------
// 3. Response Parsing & Validation Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - parseFindElementResponse parses JSON, markdown fences, and conversational wrapping', () => {
  // 1. Clean JSON object
  const cleanJson = '{"targetElementId": 4, "reason": "File upload input for submitting resume", "confidence": "high"}';
  const parsedClean = parseFindElementResponse(cleanJson);
  assert.equal(parsedClean.targetElementId, 4);
  assert.equal(parsedClean.reason, 'File upload input for submitting resume');
  assert.equal(parsedClean.confidence, 'high');

  // 2. Markdown wrapped code block
  const markdownWrapped = `\`\`\`json
{
  "targetElementId": 4,
  "reason": "File upload input"
}
\`\`\``;
  const parsedMarkdown = parseFindElementResponse(markdownWrapped);
  assert.equal(parsedMarkdown.targetElementId, 4);
  assert.equal(parsedMarkdown.reason, 'File upload input');

  // 3. Conversational prefix and suffix
  const conversational = `Based on the page analysis, here is the element:
{
  "targetElementId": 4,
  "reason": "Resume upload file picker",
  "confidence": "high"
}
Let me know if you need any more help!`;
  const parsedConversational = parseFindElementResponse(conversational);
  assert.equal(parsedConversational.targetElementId, 4);
  assert.equal(parsedConversational.reason, 'Resume upload file picker');

  // 4. Null targetElementId (element not found on page)
  const notFoundJson = '{"targetElementId": null, "reason": "No resume upload element found on the page", "confidence": "low"}';
  const parsedNotFound = parseFindElementResponse(notFoundJson);
  assert.equal(parsedNotFound.targetElementId, null);
  assert.equal(parsedNotFound.reason, 'No resume upload element found on the page');

  // 5. Alternate key targetId
  const altKeyJson = '{"targetId": 9, "reason": "Sign in button"}';
  const parsedAlt = parseFindElementResponse(altKeyJson);
  assert.equal(parsedAlt.targetElementId, 9);
  assert.equal(parsedAlt.reason, 'Sign in button');

  // 6. Regex fallback for slightly unclosed JSON
  const brokenJson = '{"targetElementId": 14, "reason": "Search bar in header"';
  const parsedBroken = parseFindElementResponse(brokenJson);
  assert.equal(parsedBroken.targetElementId, 14);
  assert.equal(parsedBroken.reason, 'Search bar in header');

  // 7. Completely invalid / garbage text
  const garbage = 'Sorry, I cannot do that.';
  const parsedGarbage = parseFindElementResponse(garbage);
  assert.equal(parsedGarbage.targetElementId, null);
  assert.equal(parsedGarbage.confidence, 'low');
});

// ---------------------------------------------------------------------------
// 4. Intent Detection Helper Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - isFindElementIntent identifies natural locator prompts in English and Hinglish', () => {
  // English Locator Queries
  assert.equal(isFindElementIntent('Where do I upload my resume?'), true);
  assert.equal(isFindElementIntent('where is the search bar'), true);
  assert.equal(isFindElementIntent('Where can I find pricing?'), true);
  assert.equal(isFindElementIntent('Find the login button'), true);
  assert.equal(isFindElementIntent('locate the submit button'), true);
  assert.equal(isFindElementIntent('Highlight the checkout button'), true);
  assert.equal(isFindElementIntent('Spotlight the apply now link'), true);
  assert.equal(isFindElementIntent('Show me where to sign up'), true);
  assert.equal(isFindElementIntent('Which button submits the form?'), true);
  assert.equal(isFindElementIntent('Where should I enter my coupon code?'), true);
  assert.equal(isFindElementIntent('find it for me: resume upload'), true);
  assert.equal(isFindElementIntent('find: checkout'), true);

  // Hinglish Locator Queries
  assert.equal(isFindElementIntent('Resume kahan upload karun?'), true);
  assert.equal(isFindElementIntent('Login button kahan hai?'), true);
  assert.equal(isFindElementIntent('Search bar dhoondho'), true);
  assert.equal(isFindElementIntent('Kahan click karun apply karne ke liye?'), true);
  assert.equal(isFindElementIntent('Apply button kidhar hai?'), true);
  assert.equal(isFindElementIntent('File upload option kahan milega?'), true);

  // Non-Locator Conversational Queries (Must be false)
  assert.equal(isFindElementIntent('Summarize this article in 3 points'), false);
  assert.equal(isFindElementIntent('What is quantum computing?'), false);
  assert.equal(isFindElementIntent('Hello ASKbro, how are you?'), false);
  assert.equal(isFindElementIntent('Can you draft an email reply to this?'), false);
});

// ---------------------------------------------------------------------------
// 5. findTargetElement AI Service Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - findTargetElement short-circuits when action map is empty', async () => {
  const result = await findTargetElement({
    query: 'Where do I upload my resume?',
    actionMap: [],
  });

  assert.equal(result.targetElementId, null);
  assert.ok(result.reason.includes('No interactive elements'));
});

test('Slice 3.2 - findTargetElement evaluates action map and validates ID existence', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"targetElementId": 4, "reason": "File upload input for resume", "confidence": "high"}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const elements: ActionableElement[] = [
      { id: 1, tag: 'input', type: 'text', name: 'search', rect: { top: 0, left: 0, width: 0, height: 0 } },
      { id: 4, tag: 'input', type: 'file', name: 'resume', rect: { top: 0, left: 0, width: 0, height: 0 } },
    ];

    const result = await findTargetElement({
      query: 'Where do I upload my resume?',
      actionMap: elements,
      apiKey: 'AIzaSyTestMockKeyForActionMap12345',
    });

    assert.equal(result.targetElementId, 4);
    assert.equal(result.reason, 'File upload input for resume');
    assert.equal(result.confidence, 'high');

    // Test hallucinatory ID validation (model returns ID 99 which is not in action map)
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"targetElementId": 99, "reason": "Unknown element"}' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const hallucinationResult = await findTargetElement({
      query: 'Where is the secret button?',
      actionMap: elements,
      apiKey: 'AIzaSyTestMockKeyForActionMap12345',
    });

    assert.equal(hallucinationResult.targetElementId, null, 'Hallucinated ID must be invalidated');
    assert.ok(hallucinationResult.reason.includes('does not exist in the active action map'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 6. Tab Content Script Bridge Helpers Tests
// ---------------------------------------------------------------------------

test('Slice 3.2 - Tab bridge helpers dispatch correct runtime messages', async () => {
  lastSentTabMessage = null;

  // 1. scanTabActionMap
  const scanRes = await scanTabActionMap(101, true);
  assert.equal(scanRes.count, 3);
  assert.equal(lastSentTabMessage.type, 'SCAN_ELEMENTS');
  assert.equal(lastSentTabMessage.showBadges, true);

  // 2. highlightTabElement
  lastSentTabMessage = null;
  const highlightSuccess = await highlightTabElement(4, 101, 3000);
  assert.equal(highlightSuccess, true);
  assert.equal(lastSentTabMessage.type, 'DRY_RUN_HIGHLIGHT');
  assert.equal(lastSentTabMessage.targetElementId, 4);
  assert.equal(lastSentTabMessage.durationMs, 3000);

  // 3. clearTabBadges
  lastSentTabMessage = null;
  const clearSuccess = await clearTabBadges(101);
  assert.equal(clearSuccess, true);
  assert.equal(lastSentTabMessage.type, 'REMOVE_BADGES');
});

// ---------------------------------------------------------------------------
// 7. Full "Find It For Me" Acceptance Criteria Orchestration Test
// ---------------------------------------------------------------------------

test('Slice 3.2 Acceptance Criteria: "Where do I upload my resume?" smoothly scrolls and pulses cyan highlight on badge #4 without clicking', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Mock Gemini API returning target ID 4
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"targetElementId": 4, "reason": "File upload input", "confidence": "high"}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    lastSentTabMessage = null;

    // Feature: User asks "Where do I upload my resume?"
    const result = await locateAndHighlightElement({
      query: 'Where do I upload my resume?',
      tabId: 101,
      apiKey: 'AIzaSyTestMockKeyForActionMap12345',
    });

    // Verify LLM returns target element ID {"targetElementId": 4, "reason": "File upload input"}
    assert.equal(result.success, true);
    assert.equal(result.found, true);
    assert.equal(result.targetElementId, 4);
    assert.equal(result.reason, 'File upload input');
    assert.equal(result.confidence, 'high');
    assert.equal(result.highlighted, true);
    assert.equal(result.element?.name, 'resume');

    // Verify DRY_RUN_HIGHLIGHT message was dispatched to content script
    assert.equal(lastSentTabMessage.type, 'DRY_RUN_HIGHLIGHT');
    assert.equal(lastSentTabMessage.targetElementId, 4);

    // Verify non-existent element: LLM returns targetElementId: null
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"targetElementId": null, "reason": "No bitcoin wallet connect button found on this page", "confidence": "high"}',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const notFoundResult = await locateAndHighlightElement({
      query: 'Where do I connect my bitcoin wallet?',
      tabId: 101,
      apiKey: 'AIzaSyTestMockKeyForActionMap12345',
    });

    assert.equal(notFoundResult.success, true);
    assert.equal(notFoundResult.found, false);
    assert.equal(notFoundResult.targetElementId, null);
    assert.equal(notFoundResult.highlighted, false);
    assert.ok(notFoundResult.reason.includes('No bitcoin wallet connect button'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
