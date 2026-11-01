import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import {
  saveChatHistorySession,
  getChatHistory,
  getChatHistorySession,
  deleteChatHistorySession,
  clearAllChatHistory,
  exportChatHistoryAsJson,
  exportChatHistoryAsMarkdown,
  getAgentActionHistory,
  clearAgentActionHistory,
  deleteAgentAuditEntry,
  getAppHistorySummary,
  clearAllAppHistory,
  extractPreviewText,
  STORAGE_KEY_CHAT_HISTORY,
  MAX_CHAT_HISTORY_ENTRIES,
  ChatHistorySession,
} from '../src/services/storage/historyStore';
import { recordAuditLogEntry, clearAuditLog } from '../src/background/stateManager';
import { createChatMessage } from '../src/services/ai/groundedChat';
import { DEFAULT_SETTINGS } from '../src/types/ai';
import HistoryView from '../src/sidepanel/components/History/HistoryView';
import App from '../src/sidepanel/App';
import ChatView from '../src/sidepanel/components/Chat/ChatView';

// ---------------------------------------------------------------------------
// Mock Storage & Environment
// ---------------------------------------------------------------------------

let mockLocalStorage: Record<string, any> = {};
let mockSessionStorage: Record<string, any> = {};

function resetMockStorage() {
  mockLocalStorage = {};
  mockSessionStorage = {};
}

(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (key: string | string[]) => {
        if (typeof key === 'string') {
          return { [key]: mockLocalStorage[key] };
        }
        const result: Record<string, any> = {};
        for (const k of key) {
          result[k] = mockLocalStorage[k];
        }
        return result;
      },
      set: async (items: Record<string, any>) => {
        Object.assign(mockLocalStorage, items);
      },
      remove: async (key: string | string[]) => {
        if (typeof key === 'string') {
          delete mockLocalStorage[key];
        } else {
          for (const k of key) delete mockLocalStorage[k];
        }
      },
    },
    session: {
      get: async (key: string | string[]) => {
        if (typeof key === 'string') {
          return { [key]: mockSessionStorage[key] };
        }
        const result: Record<string, any> = {};
        for (const k of key) {
          result[k] = mockSessionStorage[k];
        }
        return result;
      },
      set: async (items: Record<string, any>) => {
        Object.assign(mockSessionStorage, items);
      },
      remove: async (key: string | string[]) => {
        if (typeof key === 'string') {
          delete mockSessionStorage[key];
        } else {
          for (const k of key) delete mockSessionStorage[k];
        }
      },
    },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://news.ycombinator.com', title: 'Hacker News' }],
    onActivated: { addListener: () => {}, removeListener: () => {} },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: {
    onMessage: { addListener: () => {}, removeListener: () => {} },
  },
};

function renderToDom(element: React.ReactElement) {
  const html = renderToString(element);
  const dom = new JSDOM(html);
  return { html, document: dom.window.document, body: dom.window.document.body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('extractPreviewText correctly extracts snippet from messages', () => {
  const empty = extractPreviewText([]);
  assert.equal(empty, 'No messages');

  const msgs = [
    createChatMessage('user', 'What is quantum computing?'),
    createChatMessage('model', 'Quantum computing uses qubits to perform complex calculations rapidly.'),
  ];
  const preview = extractPreviewText(msgs);
  assert.equal(preview, 'Quantum computing uses qubits to perform complex calculations rapidly.');
});

test('saveChatHistorySession saves new session and updates existing session (upsert)', async () => {
  resetMockStorage();

  const msg1 = createChatMessage('user', 'Hello ASKbro');
  const msg2 = createChatMessage('model', 'Hello! How can I assist you with this webpage?');

  const created = await saveChatHistorySession({
    id: 'session_1',
    title: 'Example Page',
    url: 'https://example.com',
    messages: [msg1, msg2],
    createdAt: 1000,
  });

  assert.equal(created.id, 'session_1');
  assert.equal(created.messageCount, 2);
  assert.equal(created.title, 'Example Page');
  assert.equal(created.url, 'https://example.com');
  assert.equal(created.createdAt, 1000);

  // Retrieve and verify
  const history = await getChatHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 'session_1');

  // Upsert: Add another message to the same session
  const msg3 = createChatMessage('user', 'Can you summarize line 2?');
  const updated = await saveChatHistorySession({
    id: 'session_1',
    messages: [msg1, msg2, msg3],
    updatedAt: 2000,
  });

  assert.equal(updated.messageCount, 3);
  assert.equal(updated.createdAt, 1000); // Preserved original createdAt
  assert.equal(updated.updatedAt, 2000);

  const historyAfterUpdate = await getChatHistory();
  assert.equal(historyAfterUpdate.length, 1);
  assert.equal(historyAfterUpdate[0].messages.length, 3);
});

test('saveChatHistorySession enforces FIFO capacity bound (MAX_CHAT_HISTORY_ENTRIES = 100)', async () => {
  resetMockStorage();

  // Insert 105 sessions
  for (let i = 1; i <= 105; i++) {
    await saveChatHistorySession({
      id: `session_${i}`,
      title: `Page #${i}`,
      url: `https://example.com/${i}`,
      messages: [createChatMessage('user', `Query #${i}`)],
      createdAt: i * 10,
      updatedAt: i * 10,
    });
  }

  const all = await getChatHistory();
  assert.equal(all.length, MAX_CHAT_HISTORY_ENTRIES);
  // Most recent session (105) should be first
  assert.equal(all[0].id, 'session_105');
  // Oldest remaining should be session_6 (since 105 - 100 + 1 = 6)
  assert.equal(all[all.length - 1].id, 'session_6');
});

test('getChatHistory filters by title, url, preview, and message content', async () => {
  resetMockStorage();

  await saveChatHistorySession({
    id: 'wiki_ai',
    title: 'Artificial Intelligence - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/AI',
    messages: [
      createChatMessage('user', 'What are neural networks?'),
      createChatMessage('model', 'Neural networks are computing systems inspired by biological brains.'),
    ],
  });

  await saveChatHistorySession({
    id: 'yt_react',
    title: 'Learn React in 15 Minutes',
    url: 'https://www.youtube.com/watch?v=123',
    messages: [
      createChatMessage('user', 'Explain useState hook'),
      createChatMessage('model', 'useState allows functional components to maintain internal state.'),
    ],
  });

  // Search by URL
  const searchUrl = await getChatHistory({ search: 'wikipedia' });
  assert.equal(searchUrl.length, 1);
  assert.equal(searchUrl[0].id, 'wiki_ai');

  // Search by Title
  const searchTitle = await getChatHistory({ search: 'React' });
  assert.equal(searchTitle.length, 1);
  assert.equal(searchTitle[0].id, 'yt_react');

  // Search by message content
  const searchContent = await getChatHistory({ search: 'neural networks' });
  assert.equal(searchContent.length, 1);
  assert.equal(searchContent[0].id, 'wiki_ai');

  // Search non-existent
  const searchNone = await getChatHistory({ search: 'quantum gravity' });
  assert.equal(searchNone.length, 0);
});

test('deleteChatHistorySession and clearAllChatHistory manage storage entries', async () => {
  resetMockStorage();

  await saveChatHistorySession({
    id: 'del_1',
    title: 'To Delete 1',
    messages: [createChatMessage('user', 'hi')],
  });
  await saveChatHistorySession({
    id: 'del_2',
    title: 'To Delete 2',
    messages: [createChatMessage('user', 'hello')],
  });

  const before = await getChatHistory();
  assert.equal(before.length, 2);

  const deleted = await deleteChatHistorySession('del_1');
  assert.equal(deleted, true);

  const afterOne = await getChatHistory();
  assert.equal(afterOne.length, 1);
  assert.equal(afterOne[0].id, 'del_2');

  await clearAllChatHistory();
  const afterClear = await getChatHistory();
  assert.equal(afterClear.length, 0);
});

test('exportChatHistoryAsJson and exportChatHistoryAsMarkdown format transcripts properly', async () => {
  resetMockStorage();

  const msg1 = createChatMessage('user', 'Who is the author of this post?');
  const msg2 = createChatMessage('model', 'The author is Alice Smith.', { grounded: true });

  await saveChatHistorySession({
    id: 'session_export',
    title: 'Tech Blog Post',
    url: 'https://techblog.com/post/1',
    messages: [msg1, msg2],
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
  });

  // JSON export
  const jsonStr = await exportChatHistoryAsJson('session_export');
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Tech Blog Post');
  assert.equal(parsed[0].messages.length, 2);

  // Markdown export
  const mdStr = await exportChatHistoryAsMarkdown('session_export');
  assert.ok(mdStr.includes('# ASKbro Conversation History'));
  assert.ok(mdStr.includes('Tech Blog Post'));
  assert.ok(mdStr.includes('https://techblog.com/post/1'));
  assert.ok(mdStr.includes('Who is the author of this post?'));
  assert.ok(mdStr.includes('The author is Alice Smith.'));
  assert.ok(mdStr.includes('[GROUNDED ON DOM]'));
});

test('getAppHistorySummary and clearAllAppHistory coordinate chat and agent action logs', async () => {
  resetMockStorage();

  // Create chat session
  await saveChatHistorySession({
    id: 'chat_summary_1',
    title: 'Summary Test Page',
    messages: [createChatMessage('user', 'q1'), createChatMessage('model', 'a1')],
  });

  // Create agent audit log
  await recordAuditLogEntry(
    {
      stepNumber: 1,
      action: 'click',
      targetId: 3,
      value: null,
      reason: 'Click the submit button',
      status: 'completed',
      executedAt: Date.now(),
    },
    { goal: 'Submit the registration form', tabTitle: 'Register' }
  );

  const summary = await getAppHistorySummary();
  assert.equal(summary.chatSessionsCount, 1);
  assert.equal(summary.totalChatMessages, 2);
  assert.equal(summary.agentActionsCount, 1);
  assert.ok(summary.lastActiveTimestamp !== null);

  // Test clear all
  await clearAllAppHistory();
  const summaryAfterClear = await getAppHistorySummary();
  assert.equal(summaryAfterClear.chatSessionsCount, 0);
  assert.equal(summaryAfterClear.totalChatMessages, 0);
  assert.equal(summaryAfterClear.agentActionsCount, 0);
});

test('HistoryView UI component renders navigation, telemetry ticker, and empty state', () => {
  const { html, body } = renderToDom(
    React.createElement(HistoryView, {
      onBack: () => {},
      onLoadChatSession: () => {},
    })
  );

  assert.ok(body.textContent?.includes('Activity & Audit History'));
  assert.ok(html.includes('CONVERSATIONS'));
  assert.ok(html.includes('MESSAGES'));
  assert.ok(html.includes('AGENT ACTIONS'));
  assert.ok(html.includes('Search past conversations'));
  assert.ok(html.includes('CHATS'));
  assert.ok(html.includes('AGENT'));
  assert.ok(html.includes('TIMELINE'));
});

test('App header renders dedicated History button with testid askbro-btn-history', () => {
  const { html, document } = renderToDom(React.createElement(App, null));

  const historyBtn = document.querySelector('[data-testid="askbro-btn-history"]');
  assert.ok(historyBtn !== null, 'History button must be rendered in header bar');
  assert.equal(historyBtn?.getAttribute('aria-label'), 'History');
  assert.ok(historyBtn?.getAttribute('title')?.includes('History'));
});

test('ChatView toolbar renders History button with testid askbro-chat-history-btn', () => {
  const { html, document } = renderToDom(
    React.createElement(ChatView, {
      settings: DEFAULT_SETTINGS,
      onOpenHistory: () => {},
    })
  );

  const chatHistoryBtn = document.querySelector('[data-testid="askbro-chat-history-btn"]');
  assert.ok(chatHistoryBtn !== null, 'ChatView toolbar must include History button');
  assert.equal(chatHistoryBtn?.getAttribute('aria-label'), 'History');
});
