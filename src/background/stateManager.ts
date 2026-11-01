/**
 * ASKbro Worker Hibernation & Session State Persistence Manager (Slice 3.6)
 *
 * Implements:
 * - Real-time agent execution progress persistence to chrome.storage.session after every step
 * - Resilient rehydration when the Manifest V3 background service worker hibernates or wakes up
 * - Instant pending step state restoration when reopening or restoring the side panel
 * - High-integrity audit log recording to chrome.storage.local with FIFO capacity bounds
 * - Keep-alive heartbeat channel support between side panel and background worker
 * - Runtime message dispatcher for background service worker integration
 */

import {
  AgentTaskSession,
  AgentTaskSessionSchema,
  ActionHistoryEntry,
  ActionHistoryEntrySchema,
  ActionAuditLogEntry,
  ActionAuditLogEntrySchema,
  ActionStep,
} from '../types/action';
import {
  getSessionStorage,
  setSessionStorage,
  removeSessionStorage,
  getLocalStorage,
  setLocalStorage,
} from '../services/storage/index';
import type {
  GetAgentSessionResponse,
  SaveAgentSessionResponse,
  ClearAgentSessionResponse,
  RecordAuditLogResponse,
  GetAuditLogResponse,
  ClearAuditLogResponse,
  AgentHeartbeatResponse,
} from '../types/messages';

// ---------------------------------------------------------------------------
// Constants & Keys
// ---------------------------------------------------------------------------

export const STORAGE_KEY_AGENT_SESSION = 'askbro_agent_session';
export const STORAGE_KEY_AUDIT_LOG = 'askbro_action_audit_log';
export const MAX_AUDIT_LOG_ENTRIES = 500;

export interface AuditLogQueryOptions {
  taskId?: string;
  limit?: number;
  status?: string;
  reverse?: boolean; // If true, earliest first; default false (latest first)
}

// ---------------------------------------------------------------------------
// 1. Session State Persistence (chrome.storage.session)
// ---------------------------------------------------------------------------

/**
 * Saves current agent execution session state to chrome.storage.session.
 * Validates against AgentTaskSessionSchema and updates timestamp.
 */
export async function saveAgentSession(session: AgentTaskSession): Promise<void> {
  const validated = AgentTaskSessionSchema.parse({
    ...session,
    updatedAt: Date.now(),
  });

  await setSessionStorage<AgentTaskSession>(STORAGE_KEY_AGENT_SESSION, validated);
}

/**
 * Retrieves active agent session state from chrome.storage.session.
 * Returns null if no session exists or if persisted data is invalid.
 */
export async function getAgentSession(): Promise<AgentTaskSession | null> {
  try {
    const raw = await getSessionStorage<any>(STORAGE_KEY_AGENT_SESSION, null);
    if (!raw) return null;

    const parseResult = AgentTaskSessionSchema.safeParse(raw);
    if (parseResult.success) {
      return parseResult.data;
    } else {
      console.warn('[ASKbro StateManager] Invalid session data found in storage:', parseResult.error);
      return null;
    }
  } catch (err) {
    console.warn('[ASKbro StateManager] Error reading agent session from storage:', err);
    return null;
  }
}

/**
 * Clears the active agent session from chrome.storage.session.
 */
export async function clearAgentSession(): Promise<void> {
  await removeSessionStorage(STORAGE_KEY_AGENT_SESSION);
}

/**
 * Initializes a new agent session and persists it to session storage.
 */
export async function createAgentSession(params: {
  taskId?: string;
  goal: string;
  maxSteps?: number;
  tabId?: number | null;
  tabUrl?: string | null;
  tabTitle?: string | null;
  status?: AgentTaskSession['status'];
}): Promise<AgentTaskSession> {
  const taskId = params.taskId || `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const newSession: AgentTaskSession = {
    taskId,
    goal: params.goal,
    status: params.status || 'planning',
    currentStepIndex: 1,
    maxSteps: params.maxSteps ?? 10,
    pendingStep: null,
    pendingElement: null,
    tabId: params.tabId ?? null,
    tabUrl: params.tabUrl ?? null,
    tabTitle: params.tabTitle ?? null,
    history: [],
    skippedElementIds: [],
    startedAt: now,
    updatedAt: now,
  };

  await saveAgentSession(newSession);
  return newSession;
}

/**
 * Updates partial fields of the active session in chrome.storage.session.
 */
export async function updateAgentSession(updates: Partial<AgentTaskSession>): Promise<AgentTaskSession | null> {
  const current = await getAgentSession();
  if (!current) return null;

  const merged: AgentTaskSession = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };

  await saveAgentSession(merged);
  return merged;
}

/**
 * Saves a pending action step and matched element into the active session before user contemplation pause.
 * Sets status to 'awaiting_approval' to ensure seamless recovery across service worker hibernation.
 */
export async function savePendingStep(params: {
  step: ActionStep | null;
  matchedElement?: any;
  currentStepIndex?: number;
}): Promise<AgentTaskSession | null> {
  const current = await getAgentSession();
  if (!current) return null;

  const updated: AgentTaskSession = {
    ...current,
    status: 'awaiting_approval',
    pendingStep: params.step,
    pendingElement: params.matchedElement ?? current.pendingElement,
    currentStepIndex: params.currentStepIndex ?? current.currentStepIndex,
    updatedAt: Date.now(),
  };

  await saveAgentSession(updated);
  return updated;
}

/**
 * Appends an executed action step entry to session history and updates execution progress.
 */
export async function appendSessionStepHistory(entry: ActionHistoryEntry): Promise<AgentTaskSession | null> {
  const current = await getAgentSession();
  if (!current) return null;

  const validatedEntry = ActionHistoryEntrySchema.parse(entry);
  const updatedHistory = [...current.history, validatedEntry];

  const updated: AgentTaskSession = {
    ...current,
    history: updatedHistory,
    pendingStep: null,
    pendingElement: null,
    updatedAt: Date.now(),
  };

  await saveAgentSession(updated);
  return updated;
}

/**
 * Updates active session status (e.g., 'completed', 'aborted', 'error').
 */
export async function updateSessionStatus(
  status: AgentTaskSession['status'],
  error?: string
): Promise<AgentTaskSession | null> {
  const current = await getAgentSession();
  if (!current) return null;

  const updated: AgentTaskSession = {
    ...current,
    status,
    error: error ?? current.error,
    updatedAt: Date.now(),
  };

  await saveAgentSession(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// 2. Persistent Action Audit Log (chrome.storage.local)
// ---------------------------------------------------------------------------

/**
 * Records an action step execution into the persistent audit log in chrome.storage.local.
 * Automatically bounds the log capacity using a FIFO queue to prevent storage explosion.
 */
export async function recordAuditLogEntry(
  entry: ActionHistoryEntry,
  context?: {
    taskId?: string;
    goal?: string;
    tabId?: number | null;
    tabUrl?: string | null;
    tabTitle?: string | null;
  }
): Promise<ActionAuditLogEntry> {
  const now = Date.now();
  const id = `audit_${now}_${Math.random().toString(36).substring(2, 7)}`;

  const auditEntry: ActionAuditLogEntry = {
    id,
    taskId: context?.taskId,
    goal: context?.goal,
    tabId: context?.tabId ?? null,
    tabUrl: context?.tabUrl ?? null,
    tabTitle: context?.tabTitle ?? null,
    stepNumber: entry.stepNumber,
    action: entry.action,
    targetId: entry.targetId,
    value: entry.value,
    reason: entry.reason,
    status: entry.status,
    executedAt: entry.executedAt || now,
    error: entry.error,
    timestamp: now,
  };

  const validated = ActionAuditLogEntrySchema.parse(auditEntry);

  // Read existing audit log
  const existing = await getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []);
  const updated = [validated, ...existing];

  // Enforce FIFO capacity bound (Slice 3.6 / edge-case resilience)
  const trimmed = updated.slice(0, MAX_AUDIT_LOG_ENTRIES);

  await setLocalStorage(STORAGE_KEY_AUDIT_LOG, trimmed);
  return validated;
}

/**
 * Retrieves audit log entries from chrome.storage.local with optional filtering and pagination.
 */
export async function getAuditLog(options?: AuditLogQueryOptions): Promise<ActionAuditLogEntry[]> {
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
 * Clears audit log entries from chrome.storage.local.
 * If taskId is provided, removes only entries for that task.
 */
export async function clearAuditLog(taskId?: string): Promise<void> {
  if (!taskId) {
    await setLocalStorage(STORAGE_KEY_AUDIT_LOG, []);
    return;
  }

  const existing = await getLocalStorage<ActionAuditLogEntry[]>(STORAGE_KEY_AUDIT_LOG, []);
  const filtered = existing.filter((e) => e.taskId !== taskId);
  await setLocalStorage(STORAGE_KEY_AUDIT_LOG, filtered);
}

/**
 * Formats the audit log as a clean indented JSON string for export or inspection.
 */
export async function exportAuditLogAsJson(taskId?: string): Promise<string> {
  const entries = await getAuditLog({ taskId, reverse: true });
  return JSON.stringify(entries, null, 2);
}

// ---------------------------------------------------------------------------
// 3. Worker Hibernation & Runtime Messaging Dispatcher
// ---------------------------------------------------------------------------

export interface WorkerWakeupResult {
  hasPendingTask: boolean;
  session: AgentTaskSession | null;
  actionTaken: 'none' | 'resumed_awaiting_approval' | 'rehydrated_uncompleted_step';
}

/**
 * Handles Manifest V3 Service Worker awakening.
 * Evaluates in-flight or uncompleted agent tasks from chrome.storage.session.
 * If worker hibernated mid-task, restores state safely without dropping uncompleted steps.
 */
export async function handleWorkerWakeup(): Promise<WorkerWakeupResult> {
  const session = await getAgentSession();
  if (!session) {
    return { hasPendingTask: false, session: null, actionTaken: 'none' };
  }

  // If session is already finished or idle, no recovery needed
  if (session.status === 'completed' || session.status === 'aborted' || session.status === 'idle') {
    return { hasPendingTask: false, session, actionTaken: 'none' };
  }

  const now = Date.now();

  // If session was awaiting approval, record wake-up timestamp and keep it waiting
  if (session.status === 'awaiting_approval') {
    const updated = {
      ...session,
      lastWakeupAt: now,
      updatedAt: now,
    };
    await saveAgentSession(updated);
    console.log(`[ASKbro StateManager] Service Worker awoke: Task ${session.taskId} awaiting human approval.`);
    return {
      hasPendingTask: true,
      session: updated,
      actionTaken: 'resumed_awaiting_approval',
    };
  }

  // If worker went dormant during planning, scanning, or executing, rehydrate safely:
  // transition executing/planning back to awaiting_approval if pendingStep is present,
  // or scanning so the next step can be safely evaluated.
  const targetStatus = session.pendingStep ? 'awaiting_approval' : 'scanning';
  const rehydrated: AgentTaskSession = {
    ...session,
    status: targetStatus,
    lastWakeupAt: now,
    updatedAt: now,
  };

  await saveAgentSession(rehydrated);
  console.log(`[ASKbro StateManager] Service Worker awoke: Recovered in-flight task ${session.taskId} (status: ${targetStatus}).`);

  return {
    hasPendingTask: true,
    session: rehydrated,
    actionTaken: 'rehydrated_uncompleted_step',
  };
}

/**
 * Initializes session storage access level in service worker if supported by Chrome MV3,
 * and recovers any in-flight uncompleted session steps.
 */
export async function initWorkerSessionSupport(): Promise<WorkerWakeupResult> {
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage?.session &&
    typeof (chrome.storage.session as any).setAccessLevel === 'function'
  ) {
    try {
      await (chrome.storage.session as any).setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
      });
    } catch (err) {
      // Ignore in environments where setAccessLevel is unavailable or restricted
      console.debug('[ASKbro StateManager] Session setAccessLevel notice:', err);
    }
  }

  return await handleWorkerWakeup();
}

/**
 * Handles incoming runtime messages related to session state and audit logging.
 */
export async function handleStateManagerMessage(
  message: any
): Promise<
  | GetAgentSessionResponse
  | SaveAgentSessionResponse
  | ClearAgentSessionResponse
  | RecordAuditLogResponse
  | GetAuditLogResponse
  | ClearAuditLogResponse
  | AgentHeartbeatResponse
  | { success: false; error: string }
> {
  try {
    switch (message?.type) {
      case 'GET_AGENT_SESSION': {
        const session = await getAgentSession();
        return { success: true, session };
      }

      case 'SAVE_AGENT_SESSION': {
        if (!message.session) {
          return { success: false, error: 'Missing session payload' };
        }
        await saveAgentSession(message.session);
        return { success: true };
      }

      case 'CLEAR_AGENT_SESSION': {
        await clearAgentSession();
        return { success: true };
      }

      case 'RECORD_AUDIT_LOG': {
        if (!message.entry) {
          return { success: false, error: 'Missing entry payload' };
        }
        const auditEntry = await recordAuditLogEntry(message.entry, message.context);
        return { success: true, auditEntry };
      }

      case 'GET_AUDIT_LOG': {
        const entries = await getAuditLog(message.options);
        return { success: true, entries };
      }

      case 'CLEAR_AUDIT_LOG': {
        await clearAuditLog(message.taskId);
        return { success: true };
      }

      case 'AGENT_HEARTBEAT': {
        return {
          success: true,
          status: 'alive',
          timestamp: Date.now(),
        };
      }

      case 'CHECK_WORKER_WAKEUP': {
        const result = await handleWorkerWakeup();
        return {
          success: true,
          ...result,
        } as any;
      }

      default:
        return { success: false, error: `Unhandled state manager message type: ${message?.type}` };
    }
  } catch (err: any) {
    console.error('[ASKbro StateManager] Message handler error:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Helper to rehydrate active session when the side panel is opened or restored.
 * Returns the session and an isRestored flag indicating whether work can resume.
 */
export async function rehydratePendingSession(): Promise<{
  session: AgentTaskSession | null;
  isRestored: boolean;
}> {
  const session = await getAgentSession();
  if (!session) {
    return { session: null, isRestored: false };
  }

  // Active states that warrant instant resumption in UI
  const isResumable =
    session.status === 'awaiting_approval' ||
    session.status === 'scanning' ||
    session.status === 'planning' ||
    session.status === 'executing';

  return {
    session,
    isRestored: isResumable,
  };
}

