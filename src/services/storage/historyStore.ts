/**
 * ASKbro History & Audit Storage Service (Slice 3.6 / History Access)
 *
 * Provides:
 * - Persistent chat session conversation history in chrome.storage.local
 * - FIFO capacity bounds (100 items) to guard against QUOTA_BYTES_PER_ITEM
 * - Search & filter across past conversations, page titles, and URLs
 * - JSON and Markdown export of chat transcripts
 * - Unified access to persistent Agent Action Audit Logs
 * - Resume/Load conversation capability
 */

import { ChatMessage } from '../../types/ai';
import { ActionAuditLogEntry } from '../../types/action';
import { getLocalStorage, setLocalStorage } from './index';

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

export const STORAGE_KEY_CHAT_HISTORY = 'askbro_chat_history';
export const STORAGE_KEY_AUDIT_LOG = 'askbro_action_audit_log';
export const MAX_CHAT_HISTORY_ENTRIES = 100;

export interface AuditLogQueryOptions {
  taskId?: string;
  limit?: number;
  status?: string;
  reverse?: boolean;
}

export interface ChatHistorySession {
  id: string;
  tabId?: number;
  title: string;
  url: string;
  messages: ChatMessage[];
  pageContextSummary?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  previewText: string;
}

export interface ChatHistoryFilterOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AppHistorySummary {
  chatSessionsCount: number;
  totalChatMessages: number;
  agentActionsCount: number;
  lastActiveTimestamp: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a concise single-line preview from conversation messages
 */
export function extractPreviewText(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) return 'No messages';
  const lastMsg = messages[messages.length - 1];
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = lastMsg?.content || firstUser?.content || '';
  return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140) || 'Empty message';
}

// ---------------------------------------------------------------------------
// Chat History CRUD & Query
// ---------------------------------------------------------------------------

/**
 * Saves or updates a chat conversation in persistent chrome.storage.local.
 * Maintains a strict FIFO queue of MAX_CHAT_HISTORY_ENTRIES.
 */
export async function saveChatHistorySession(
  session: Partial<ChatHistorySession> & { id: string; messages: ChatMessage[] }
): Promise<ChatHistorySession> {
  const now = Date.now();
  const existing = await getLocalStorage<ChatHistorySession[]>(STORAGE_KEY_CHAT_HISTORY, []);

  const preview = session.previewText || extractPreviewText(session.messages);
  const title = session.title?.trim() || 'Active Web Page';
  const url = session.url || '';

  const fullSession: ChatHistorySession = {
    id: session.id,
    tabId: session.tabId,
    title,
    url,
    messages: session.messages,
    pageContextSummary: session.pageContextSummary,
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || now,
    messageCount: session.messages.length,
    previewText: preview,
  };

  // Find index of existing session with same ID
  const existingIndex = existing.findIndex((item) => item.id === session.id);

  let updatedList: ChatHistorySession[];
  if (existingIndex >= 0) {
    // Preserve original createdAt if not provided
    fullSession.createdAt = session.createdAt || existing[existingIndex].createdAt || now;
    // Replace and move to the top
    const withoutExisting = existing.filter((item) => item.id !== session.id);
    updatedList = [fullSession, ...withoutExisting];
  } else {
    // Prepend new session
    updatedList = [fullSession, ...existing];
  }

  // Enforce FIFO capacity bound to prevent quota exhaustion
  const trimmed = updatedList.slice(0, MAX_CHAT_HISTORY_ENTRIES);

  await setLocalStorage(STORAGE_KEY_CHAT_HISTORY, trimmed);
  return fullSession;
}

/**
 * Retrieves stored chat history sessions with optional text search and pagination.
 */
export async function getChatHistory(options?: ChatHistoryFilterOptions): Promise<ChatHistorySession[]> {
  const sessions = await getLocalStorage<ChatHistorySession[]>(STORAGE_KEY_CHAT_HISTORY, []);

  // Sort newest first
  let result = [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (options?.search && options.search.trim()) {
    const term = options.search.toLowerCase().trim();
    result = result.filter((s) => {
      if (s.title.toLowerCase().includes(term)) return true;
      if (s.url.toLowerCase().includes(term)) return true;
      if (s.previewText.toLowerCase().includes(term)) return true;
      // Search inside individual messages
      return s.messages.some((m) => m.content.toLowerCase().includes(term));
    });
  }

  const offset = options?.offset ?? 0;
  if (offset > 0) {
    result = result.slice(offset);
  }

  if (options?.limit && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * Gets a specific chat session by ID
 */
export async function getChatHistorySession(id: string): Promise<ChatHistorySession | null> {
  const sessions = await getLocalStorage<ChatHistorySession[]>(STORAGE_KEY_CHAT_HISTORY, []);
  return sessions.find((s) => s.id === id) || null;
}

/**
 * Deletes a single chat session by ID
 */
export async function deleteChatHistorySession(id: string): Promise<boolean> {
  const sessions = await getLocalStorage<ChatHistorySession[]>(STORAGE_KEY_CHAT_HISTORY, []);
  const initialLength = sessions.length;
  const filtered = sessions.filter((s) => s.id !== id);

  if (filtered.length !== initialLength) {
    await setLocalStorage(STORAGE_KEY_CHAT_HISTORY, filtered);
    return true;
  }
  return false;
}

/**
 * Clears all chat history sessions from storage
 */
export async function clearAllChatHistory(): Promise<void> {
  await setLocalStorage(STORAGE_KEY_CHAT_HISTORY, []);
}

/**
 * Exports chat history as formatted JSON string
 */
export async function exportChatHistoryAsJson(id?: string): Promise<string> {
  if (id) {
    const session = await getChatHistorySession(id);
    return JSON.stringify(session ? [session] : [], null, 2);
  }
  const sessions = await getChatHistory();
  return JSON.stringify(sessions, null, 2);
}

/**
 * Exports a chat session or all sessions as clean Markdown transcript
 */
export async function exportChatHistoryAsMarkdown(id?: string): Promise<string> {
  const sessions = id
    ? [await getChatHistorySession(id)].filter((s): s is ChatHistorySession => s !== null)
    : await getChatHistory();

  if (sessions.length === 0) {
    return '# ASKbro Chat History\n\nNo conversations recorded.';
  }

  const parts: string[] = ['# ASKbro Conversation History\n'];

  for (const s of sessions) {
    const dateStr = new Date(s.updatedAt).toLocaleString();
    parts.push(`## ${s.title}`);
    parts.push(`- **Target URL:** ${s.url || 'None'}`);
    parts.push(`- **Date:** ${dateStr}`);
    parts.push(`- **Messages:** ${s.messageCount}\n`);

    for (const msg of s.messages) {
      const sender = msg.role === 'user' ? '👤 User' : '🤖 ASKbro AI';
      const time = msg.timestamp ? ` *(${new Date(msg.timestamp).toLocaleTimeString()})*` : '';
      const groundedBadge = msg.grounded ? ' `[GROUNDED ON DOM]`' : '';
      parts.push(`### ${sender}${time}${groundedBadge}\n`);
      parts.push(`${msg.content}\n`);
    }

    parts.push('---\n');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Agent Audit Log Wrappers & Unified History
// ---------------------------------------------------------------------------

/**
 * Retrieves agent action execution audit logs
 */
export async function getAgentActionHistory(options?: AuditLogQueryOptions): Promise<ActionAuditLogEntry[]> {
  const entries = await getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []);
  let filtered = entries;
  if (options?.taskId) {
    filtered = filtered.filter((e) => e.taskId === options.taskId);
  }
  if (options?.status) {
    filtered = filtered.filter((e) => e.status === options.status);
  }
  if (options?.reverse) {
    filtered = [...filtered].reverse();
  }
  if (options?.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}

/**
 * Clears agent action audit logs
 */
export async function clearAgentActionHistory(taskId?: string): Promise<void> {
  if (!taskId) {
    await setLocalStorage(STORAGE_KEY_AUDIT_LOG, []);
    return;
  }
  const existing = await getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []);
  const filtered = existing.filter((e) => e.taskId !== taskId);
  await setLocalStorage(STORAGE_KEY_AUDIT_LOG, filtered);
}

/**
 * Exports agent action audit logs as JSON string
 */
export async function exportAgentActionHistoryAsJson(taskId?: string): Promise<string> {
  const entries = await getAgentActionHistory({ taskId, reverse: true });
  return JSON.stringify(entries, null, 2);
}

/**
 * Deletes a single audit log entry by its ID
 */
export async function deleteAgentAuditEntry(id: string): Promise<boolean> {
  const existing = await getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []);
  const initialLength = existing.length;
  const filtered = existing.filter((e) => e.id !== id);

  if (filtered.length !== initialLength) {
    await setLocalStorage(STORAGE_KEY_AUDIT_LOG, filtered);
    return true;
  }
  return false;
}

/**
 * Computes top-level counts and statistics for the History overview
 */
export async function getAppHistorySummary(): Promise<AppHistorySummary> {
  const [chatSessions, auditEntries] = await Promise.all([
    getLocalStorage<ChatHistorySession[]>(STORAGE_KEY_CHAT_HISTORY, []),
    getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []),
  ]);

  const totalChatMessages = chatSessions.reduce((acc, curr) => acc + (curr.messageCount || curr.messages?.length || 0), 0);
  const latestChatTimestamp = chatSessions[0]?.updatedAt || null;
  const latestAuditTimestamp = auditEntries[0]?.timestamp || null;

  let lastActiveTimestamp: number | null = null;
  if (latestChatTimestamp && latestAuditTimestamp) {
    lastActiveTimestamp = Math.max(latestChatTimestamp, latestAuditTimestamp);
  } else {
    lastActiveTimestamp = latestChatTimestamp || latestAuditTimestamp;
  }

  return {
    chatSessionsCount: chatSessions.length,
    totalChatMessages,
    agentActionsCount: auditEntries.length,
    lastActiveTimestamp,
  };
}

/**
 * Clears all conversation and audit history across the extension
 */
export async function clearAllAppHistory(): Promise<void> {
  await Promise.all([
    clearAllChatHistory(),
    clearAgentActionHistory(),
  ]);
}
