import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_MENU_IDS,
  MENU_ACTION_MAP,
  MENU_CONFIGS,
  STORAGE_KEY_PENDING_ACTION,
  setupContextMenus,
  handleContextMenuClick,
  setPendingContextAction,
  getPendingContextAction,
  clearPendingContextAction,
} from '../src/background/menuHandler';

import {
  buildExplainPrompt,
  buildTranslatePrompt,
  buildDraftReplyPrompt,
  buildContextMenuActionPrompt,
  executeContextMenuAction,
  streamContextMenuAction,
  MAX_SELECTED_TEXT_CHARS,
} from '../src/services/ai/contextMenuActions';

import { ContextMenuActionPayload } from '../src/types/messages';

// Setup Mock Chrome Environment
const mockStorageStore: Record<string, any> = {};
const createdMenus: chrome.contextMenus.CreateProperties[] = [];
let sidePanelOpenCalls: Array<{ tabId?: number; windowId?: number }> = [];
let runtimeSentMessages: any[] = [];

(globalThis as any).chrome = {
  contextMenus: {
    removeAll: (callback?: () => void) => {
      createdMenus.length = 0;
      if (callback) callback();
    },
    create: (props: chrome.contextMenus.CreateProperties) => {
      createdMenus.push(props);
    },
    onClicked: {
      addListener: () => {},
    },
  },
  sidePanel: {
    open: async (options: { tabId?: number; windowId?: number }) => {
      sidePanelOpenCalls.push(options);
      return Promise.resolve();
    },
  },
  runtime: {
    onInstalled: {
      addListener: () => {},
    },
    sendMessage: async (msg: any) => {
      runtimeSentMessages.push(msg);
      return Promise.resolve();
    },
  },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mockStorageStore[key] }),
      set: async (items: Record<string, any>) => Object.assign(mockStorageStore, items),
      remove: async (key: string) => {
        delete mockStorageStore[key];
      },
    },
    session: {
      get: async (key: string) => ({ [key]: mockStorageStore[key] }),
      set: async (items: Record<string, any>) => Object.assign(mockStorageStore, items),
    },
  },
};

test('Slice 2.2 - Context Menu Configuration & IDs', () => {
  assert.equal(CONTEXT_MENU_IDS.EXPLAIN, 'askbro-explain');
  assert.equal(CONTEXT_MENU_IDS.TRANSLATE, 'askbro-translate');
  assert.equal(CONTEXT_MENU_IDS.REPLY, 'askbro-reply');

  assert.equal(MENU_ACTION_MAP['askbro-explain'], 'explain');
  assert.equal(MENU_ACTION_MAP['askbro-translate'], 'translate');
  assert.equal(MENU_ACTION_MAP['askbro-reply'], 'reply');

  assert.equal(MENU_CONFIGS.length, 3);
  assert.deepEqual(MENU_CONFIGS[0], {
    id: 'askbro-explain',
    title: 'Explain this with ASKbro',
    contexts: ['selection'],
  });
  assert.deepEqual(MENU_CONFIGS[1], {
    id: 'askbro-translate',
    title: 'Translate to Hindi/Hinglish',
    contexts: ['selection'],
  });
  assert.deepEqual(MENU_CONFIGS[2], {
    id: 'askbro-reply',
    title: 'Draft a reply to this',
    contexts: ['selection'],
  });
});

test('Slice 2.2 - setupContextMenus registers the 3 menu items', () => {
  setupContextMenus();
  assert.equal(createdMenus.length, 3);
  assert.equal(createdMenus[0].id, 'askbro-explain');
  assert.equal(createdMenus[0].title, 'Explain this with ASKbro');
  assert.equal(createdMenus[1].id, 'askbro-translate');
  assert.equal(createdMenus[1].title, 'Translate to Hindi/Hinglish');
  assert.equal(createdMenus[2].id, 'askbro-reply');
  assert.equal(createdMenus[2].title, 'Draft a reply to this');
});

test('Slice 2.2 - handleContextMenuClick captures selectedText and triggers sidePanel.open', async () => {
  sidePanelOpenCalls = [];
  runtimeSentMessages = [];
  delete mockStorageStore[STORAGE_KEY_PENDING_ACTION];

  const clickInfo = {
    menuItemId: 'askbro-explain',
    selectionText: 'Quantum computing leverages superposition and entanglement to perform complex operations.',
    pageUrl: 'https://en.wikipedia.org/wiki/Quantum_computing',
    editable: false,
    modifiers: [],
  } as unknown as chrome.contextMenus.OnClickData;

  const mockTab = {
    id: 101,
    windowId: 1,
    title: 'Quantum Computing - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Quantum_computing',
  } as chrome.tabs.Tab;

  const payload = await handleContextMenuClick(clickInfo, mockTab);

  assert.ok(payload);
  assert.equal(payload.action, 'explain');
  assert.equal(payload.selectedText, clickInfo.selectionText);
  assert.equal(payload.tabId, 101);
  assert.equal(payload.pageTitle, 'Quantum Computing - Wikipedia');
  assert.ok(payload.id.startsWith('ctx_'));
  assert.ok(payload.timestamp > 0);

  // Staged in storage for cold-start pickup
  const staged = await getPendingContextAction();
  assert.deepEqual(staged, payload);

  // Side panel was opened for the tab
  assert.equal(sidePanelOpenCalls.length, 1);
  assert.equal(sidePanelOpenCalls[0].tabId, 101);

  // Runtime message broadcasted
  assert.equal(runtimeSentMessages.length, 1);
  assert.equal(runtimeSentMessages[0].type, 'CONTEXT_MENU_ACTION');
  assert.deepEqual(runtimeSentMessages[0].payload, payload);
});

test('Slice 2.2 - handleContextMenuClick handles Translate and Reply actions', async () => {
  const translateClick = {
    menuItemId: 'askbro-translate',
    selectionText: 'Please review the attached contract before signing.',
  } as unknown as chrome.contextMenus.OnClickData;

  const translatePayload = await handleContextMenuClick(translateClick, { id: 202 } as chrome.tabs.Tab);
  assert.ok(translatePayload);
  assert.equal(translatePayload.action, 'translate');
  assert.equal(translatePayload.selectedText, 'Please review the attached contract before signing.');

  const replyClick = {
    menuItemId: 'askbro-reply',
    selectionText: 'Hey, are you free for a quick sync tomorrow at 10 AM?',
  } as unknown as chrome.contextMenus.OnClickData;

  const replyPayload = await handleContextMenuClick(replyClick, { id: 203 } as chrome.tabs.Tab);
  assert.ok(replyPayload);
  assert.equal(replyPayload.action, 'reply');
  assert.equal(replyPayload.selectedText, 'Hey, are you free for a quick sync tomorrow at 10 AM?');
});

test('Slice 2.2 - handleContextMenuClick ignores unknown menu item or empty selection', async () => {
  const invalidClick = {
    menuItemId: 'some-other-menu',
    selectionText: 'Hello',
  } as unknown as chrome.contextMenus.OnClickData;

  const res1 = await handleContextMenuClick(invalidClick);
  assert.equal(res1, null);

  const emptySelectionClick = {
    menuItemId: 'askbro-explain',
    selectionText: '    ',
  } as unknown as chrome.contextMenus.OnClickData;

  const res2 = await handleContextMenuClick(emptySelectionClick);
  assert.equal(res2, null);
});

test('Slice 2.2 - Pending Context Action Lifecycle & Stale Expiration', async () => {
  const freshAction: ContextMenuActionPayload = {
    id: 'test_1',
    action: 'explain',
    selectedText: 'Test content',
    timestamp: Date.now(),
  };

  await setPendingContextAction(freshAction);
  const retrieved = await getPendingContextAction();
  assert.deepEqual(retrieved, freshAction);

  // Clear pending
  await clearPendingContextAction();
  const cleared = await getPendingContextAction();
  assert.equal(cleared, null);

  // Stale action (> 5 minutes old) should be automatically expired & cleared
  const staleAction: ContextMenuActionPayload = {
    id: 'test_stale',
    action: 'translate',
    selectedText: 'Stale text',
    timestamp: Date.now() - 6 * 60 * 1000, // 6 mins ago
  };

  await setPendingContextAction(staleAction);
  const shouldBeNull = await getPendingContextAction();
  assert.equal(shouldBeNull, null);
  // Verify storage was cleaned
  assert.equal(mockStorageStore[STORAGE_KEY_PENDING_ACTION], undefined);
});

test('Slice 2.2 - buildExplainPrompt (English Mode)', () => {
  const snippet = 'OAuth 2.0 is an authorization framework that enables applications to obtain limited access.';
  const { systemInstruction, userPrompt } = buildExplainPrompt(snippet, 'en');

  assert.ok(systemInstruction.includes('Core Idea'));
  assert.ok(systemInstruction.includes('Key Breakdown'));
  assert.ok(systemInstruction.includes('Practical Example or Analogy'));
  assert.ok(systemInstruction.includes('<selected_text>'));
  assert.ok(userPrompt.includes('<selected_text>\nOAuth 2.0'));
});

test('Slice 2.2 - buildExplainPrompt (Hinglish Mode)', () => {
  const snippet = 'Machine learning models rely on gradient descent to minimize cost function.';
  const { systemInstruction, userPrompt } = buildExplainPrompt(snippet, 'hinglish');

  assert.ok(systemInstruction.includes('Asli Matlab (Core Idea)'));
  assert.ok(systemInstruction.includes('Breakdown (Key Concepts & Jargon)'));
  assert.ok(systemInstruction.includes('Real-Life Example / Analogy'));
  assert.ok(systemInstruction.includes('Do NOT use Devanagari script'));
  assert.ok(systemInstruction.includes('Roman Hinglish'));
  assert.ok(userPrompt.includes('<selected_text>\nMachine learning'));
});

test('Slice 2.2 - buildTranslatePrompt (Dual Devanagari & Hinglish)', () => {
  const snippet = 'Your subscription has been renewed successfully.';
  const { systemInstruction, userPrompt } = buildTranslatePrompt(snippet, 'en');

  assert.ok(systemInstruction.includes('1. Hindi (Devanagari - हिंदी)'));
  assert.ok(systemInstruction.includes('2. Hinglish (Roman Script)'));
  assert.ok(systemInstruction.includes('3. Key Terms & Nuance Notes'));
  assert.ok(systemInstruction.includes('<selected_text>'));
  assert.ok(userPrompt.includes('<selected_text>\nYour subscription'));
});

test('Slice 2.2 - buildDraftReplyPrompt (Professional, Direct, Casual)', () => {
  const snippet = 'Would you be interested in speaking at our tech conference next month?';
  const { systemInstruction, userPrompt } = buildDraftReplyPrompt(snippet, 'en', {
    tone: 'direct',
  });

  assert.ok(systemInstruction.includes('1. Professional & Polite'));
  assert.ok(systemInstruction.includes('2. Direct & Crisp'));
  assert.ok(systemInstruction.includes('3. Friendly & Casual'));
  assert.ok(systemInstruction.includes('Prioritize a crisp, direct response first'));
  assert.ok(userPrompt.includes('<selected_text>\nWould you be interested'));
});

test('Slice 2.2 - buildDraftReplyPrompt (Hinglish Mode)', () => {
  const snippet = 'Kal milte hain chai pe project discuss karne.';
  const { systemInstruction } = buildDraftReplyPrompt(snippet, 'hinglish');

  assert.ok(systemInstruction.includes('4. Hinglish Draft (Colloquial Roman Script)'));
  assert.ok(systemInstruction.includes('Colloquial Roman Script'));
});

test('Slice 2.2 - buildContextMenuActionPrompt Dispatches Correctly', () => {
  const text = 'Sample text';
  const explain = buildContextMenuActionPrompt('explain', text, 'en');
  assert.ok(explain.systemInstruction.includes('Core Idea'));

  const translate = buildContextMenuActionPrompt('translate', text, 'en');
  assert.ok(translate.systemInstruction.includes('Hindi (Devanagari'));

  const reply = buildContextMenuActionPrompt('reply', text, 'en');
  assert.ok(reply.systemInstruction.includes('Professional & Polite'));
});

test('Slice 2.2 - Long Selected Text Truncates Gracefully', () => {
  const longText = 'A'.repeat(MAX_SELECTED_TEXT_CHARS + 500);
  const { userPrompt } = buildExplainPrompt(longText, 'en');

  assert.ok(userPrompt.includes('(Note: Text was truncated to fit context comfortably)'));
});

test('Slice 2.2 - executeContextMenuAction & streamContextMenuAction flow', async () => {
  // Mock fetch to simulate Gemini API response
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '### 1. Core Idea\nThis is a mock explanation.' }],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    } as unknown as Response;
  };

  try {
    const output = await executeContextMenuAction({
      action: 'explain',
      selectedText: 'Test text',
      apiKey: 'test-api-key-12345678',
      model: 'gemini-1.5-flash-lite',
    });

    assert.ok(output.includes('This is a mock explanation.'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slice 2.2 - Explain Section Style Presets (Simple ELI5 & Bullet Points)', () => {
  const text = 'Asymmetric cryptography uses a public key for encryption and a private key for decryption.';

  // English Simple (ELI5)
  const simpleEn = buildExplainPrompt(text, 'en', { style: 'simple' });
  assert.ok(simpleEn.systemInstruction.includes('ELI5'));
  assert.ok(simpleEn.systemInstruction.includes('Everyday Analogy'));

  // English Bullet
  const bulletEn = buildExplainPrompt(text, 'en', { style: 'bullet' });
  assert.ok(bulletEn.systemInstruction.includes('Key Takeaways'));

  // Hinglish Simple (ELI5)
  const simpleHi = buildExplainPrompt(text, 'hinglish', { style: 'simple' });
  assert.ok(simpleHi.systemInstruction.includes('Aasan Analogy'));
  assert.ok(simpleHi.systemInstruction.includes('Asli Matlab (Simple Explanation)'));

  // Hinglish Bullet
  const bulletHi = buildExplainPrompt(text, 'hinglish', { style: 'bullet' });
  assert.ok(bulletHi.systemInstruction.includes('Mukhya Baatein'));

  // Dispatches via buildContextMenuActionPrompt
  const dispatched = buildContextMenuActionPrompt('explain', text, 'en', { explainStyle: 'simple' });
  assert.ok(dispatched.systemInstruction.includes('ELI5'));
});


