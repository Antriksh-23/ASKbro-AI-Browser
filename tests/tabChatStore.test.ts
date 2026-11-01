import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTabChatStore,
  getTabSession,
  setTabSession,
  saveTabMessages,
  clearTabMessages,
  removeTabSession,
  clearAllTabSessions,
  getAllTabSessions,
  getStoreActiveTabId,
  setStoreActiveTabId,
} from '../src/services/storage/tabChatStore';
import { createChatMessage } from '../src/services/ai/groundedChat';

test('tabChatStore - manages separate sessions per tabId', () => {
  clearAllTabSessions();

  // Tab 1: Wikipedia article
  setTabSession(101, {
    tabId: 101,
    url: 'https://en.wikipedia.org/wiki/JavaScript',
    title: 'JavaScript - Wikipedia',
    pageError: null,
    activeTabInfo: {
      title: 'JavaScript - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/JavaScript',
      isRestricted: false,
    },
  });

  const msg1 = createChatMessage('user', 'When was JavaScript created?');
  const msg2 = createChatMessage('model', 'JavaScript was created in 1995 by Brendan Eich.', { grounded: true });
  saveTabMessages(101, [msg1, msg2]);

  // Tab 2: YouTube video
  setTabSession(102, {
    tabId: 102,
    url: 'https://www.youtube.com/watch?v=abc12345',
    title: 'Learn Python in 1 Hour',
    pageError: null,
    activeTabInfo: {
      title: 'Learn Python in 1 Hour',
      url: 'https://www.youtube.com/watch?v=abc12345',
      isRestricted: false,
    },
  });

  const msg3 = createChatMessage('user', 'Summarize this video');
  const msg4 = createChatMessage('model', 'This tutorial covers Python syntax, functions, and OOP.', { grounded: true });
  saveTabMessages(102, [msg3, msg4]);

  // Verify Tab 101 session isolation
  const session101 = getTabSession(101);
  assert.ok(session101);
  assert.equal(session101.tabId, 101);
  assert.equal(session101.url, 'https://en.wikipedia.org/wiki/JavaScript');
  assert.equal(session101.title, 'JavaScript - Wikipedia');
  assert.equal(session101.messages.length, 2);
  assert.equal(session101.messages[0].content, 'When was JavaScript created?');
  assert.equal(session101.messages[1].content, 'JavaScript was created in 1995 by Brendan Eich.');

  // Verify Tab 102 session isolation
  const session102 = getTabSession(102);
  assert.ok(session102);
  assert.equal(session102.tabId, 102);
  assert.equal(session102.url, 'https://www.youtube.com/watch?v=abc12345');
  assert.equal(session102.title, 'Learn Python in 1 Hour');
  assert.equal(session102.messages.length, 2);
  assert.equal(session102.messages[0].content, 'Summarize this video');
  assert.equal(session102.messages[1].content, 'This tutorial covers Python syntax, functions, and OOP.');
});

test('tabChatStore - clearTabMessages clears only the target tab', () => {
  clearAllTabSessions();

  // Initialize both tabs
  saveTabMessages(201, [createChatMessage('user', 'Tab 201 message')]);
  saveTabMessages(202, [createChatMessage('user', 'Tab 202 message')]);

  assert.equal(getTabSession(201)?.messages.length, 1);
  assert.equal(getTabSession(202)?.messages.length, 1);

  // Clear Tab 201
  clearTabMessages(201);

  assert.equal(getTabSession(201)?.messages.length, 0);
  assert.equal(getTabSession(202)?.messages.length, 1);
  assert.equal(getTabSession(202)?.messages[0].content, 'Tab 202 message');
});

test('tabChatStore - removeTabSession removes tab when closed', () => {
  clearAllTabSessions();

  setTabSession(301, { tabId: 301, url: 'https://example.com' });
  assert.ok(getTabSession(301));

  removeTabSession(301);
  assert.equal(getTabSession(301), undefined);
});

test('tabChatStore - activeTabId tracking', () => {
  setStoreActiveTabId(501);
  assert.equal(getStoreActiveTabId(), 501);

  setStoreActiveTabId(502);
  assert.equal(getStoreActiveTabId(), 502);

  setStoreActiveTabId(null);
  assert.equal(getStoreActiveTabId(), null);
});

test('tabChatStore - preserves draft input across tab switches', () => {
  clearAllTabSessions();

  setTabSession(401, {
    tabId: 401,
    url: 'https://example.com/draft-test',
    title: 'Draft Test',
    draftInput: 'Unsent user query about pricing',
  });

  const session = getTabSession(401);
  assert.ok(session);
  assert.equal(session.draftInput, 'Unsent user query about pricing');
});

