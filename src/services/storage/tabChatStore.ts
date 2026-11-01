/**
 * ASKbro Tab-Aware Chat Session Store
 *
 * Manages separate grounded chat sessions, message histories, page contexts,
 * and drafts keyed by browser tabId. Ensures that switching tabs seamlessly
 * updates the chat view to match the active tab's context and conversation.
 */

import { ChatMessage } from '../../types/ai';
import { PageContentResponse } from '../../types/messages';
import { getSessionStorage, setSessionStorage } from './index';

export interface TabChatSession {
  tabId: number;
  sessionId?: string;
  url: string;
  title: string;
  messages: ChatMessage[];
  pageContext: PageContentResponse | null;
  pageError: string | null;
  activeTabInfo: {
    title: string;
    url: string;
    isRestricted?: boolean;
  } | null;
  draftInput?: string;
  updatedAt: number;
}

const TAB_CHAT_SESSIONS_STORAGE_KEY = 'askbro_tab_chat_sessions';

// In-memory sessions store for instant zero-latency retrieval
const sessionsMap = new Map<number, TabChatSession>();
let currentActiveTabId: number | null = null;
let isInitialized = false;

/**
 * Initializes the store by attempting to rehydrate persisted sessions from chrome.storage.session
 */
export async function initTabChatStore(): Promise<void> {
  if (isInitialized) return;
  try {
    const saved = await getSessionStorage<Record<string, TabChatSession>>(
      TAB_CHAT_SESSIONS_STORAGE_KEY,
      {}
    );
    if (saved && typeof saved === 'object') {
      for (const [key, session] of Object.entries(saved)) {
        const numId = Number(key);
        if (!isNaN(numId) && session && Array.isArray(session.messages)) {
          sessionsMap.set(numId, session);
        }
      }
    }
  } catch (err) {
    console.warn('[ASKbro TabChatStore] Rehydration warning:', err);
  } finally {
    isInitialized = true;
  }
}

/**
 * Persists the current sessions map to chrome.storage.session asynchronously
 */
async function persistSessions(): Promise<void> {
  try {
    const record: Record<string, TabChatSession> = {};
    for (const [id, session] of sessionsMap.entries()) {
      record[id.toString()] = session;
    }
    await setSessionStorage(TAB_CHAT_SESSIONS_STORAGE_KEY, record);
  } catch (err) {
    console.warn('[ASKbro TabChatStore] Persistence error:', err);
  }
}

/**
 * Retrieves the chat session for a given tabId
 */
export function getTabSession(tabId: number): TabChatSession | undefined {
  return sessionsMap.get(tabId);
}

/**
 * Updates or creates a chat session for a given tabId
 */
export function setTabSession(
  tabId: number,
  sessionUpdate: Partial<TabChatSession>
): TabChatSession {
  const existing = sessionsMap.get(tabId);
  const now = Date.now();

  const updated: TabChatSession = {
    tabId,
    sessionId: sessionUpdate.sessionId ?? existing?.sessionId ?? `chat_${now}_${Math.random().toString(36).substring(2, 7)}`,
    url: sessionUpdate.url ?? existing?.url ?? '',
    title: sessionUpdate.title ?? existing?.title ?? 'Active Tab',
    messages: sessionUpdate.messages ?? existing?.messages ?? [],
    pageContext: sessionUpdate.pageContext !== undefined ? sessionUpdate.pageContext : (existing?.pageContext ?? null),
    pageError: sessionUpdate.pageError !== undefined ? sessionUpdate.pageError : (existing?.pageError ?? null),
    activeTabInfo: sessionUpdate.activeTabInfo !== undefined ? sessionUpdate.activeTabInfo : (existing?.activeTabInfo ?? null),
    draftInput: sessionUpdate.draftInput !== undefined ? sessionUpdate.draftInput : (existing?.draftInput ?? ''),
    updatedAt: now,
  };

  sessionsMap.set(tabId, updated);
  persistSessions();
  return updated;
}

/**
 * Saves updated messages for a specific tab
 */
export function saveTabMessages(tabId: number, messages: ChatMessage[]): void {
  const existing = sessionsMap.get(tabId);
  if (existing) {
    existing.messages = messages;
    existing.updatedAt = Date.now();
  } else {
    sessionsMap.set(tabId, {
      tabId,
      sessionId: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      url: '',
      title: 'Active Tab',
      messages,
      pageContext: null,
      pageError: null,
      activeTabInfo: null,
      draftInput: '',
      updatedAt: Date.now(),
    });
  }
  persistSessions();
}

/**
 * Clears chat messages for a specific tab (e.g. user clicks "Clear Chat")
 */
export function clearTabMessages(tabId: number): void {
  const existing = sessionsMap.get(tabId);
  if (existing) {
    existing.messages = [];
    existing.sessionId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    existing.updatedAt = Date.now();
    persistSessions();
  }
}

/**
 * Removes a session when its tab is closed
 */
export function removeTabSession(tabId: number): void {
  if (sessionsMap.has(tabId)) {
    sessionsMap.delete(tabId);
    persistSessions();
  }
}

/**
 * Returns a dictionary of all active tab sessions (useful for tests and debug)
 */
export function getAllTabSessions(): Record<number, TabChatSession> {
  const result: Record<number, TabChatSession> = {};
  for (const [id, session] of sessionsMap.entries()) {
    result[id] = session;
  }
  return result;
}

/**
 * Resets all tab sessions (e.g. extension reset / tests)
 */
export function clearAllTabSessions(): void {
  sessionsMap.clear();
  persistSessions();
}

/**
 * Gets the current active tab ID tracked by the store
 */
export function getStoreActiveTabId(): number | null {
  return currentActiveTabId;
}

/**
 * Sets the current active tab ID tracked by the store
 */
export function setStoreActiveTabId(tabId: number | null): void {
  currentActiveTabId = tabId;
}

