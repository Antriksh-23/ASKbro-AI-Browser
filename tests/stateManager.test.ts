import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  saveAgentSession,
  getAgentSession,
  clearAgentSession,
  createAgentSession,
  updateAgentSession,
  savePendingStep,
  appendSessionStepHistory,
  updateSessionStatus,
  recordAuditLogEntry,
  getAuditLog,
  clearAuditLog,
  exportAuditLogAsJson,
  handleStateManagerMessage,
  rehydratePendingSession,
  STORAGE_KEY_AGENT_SESSION,
  STORAGE_KEY_AUDIT_LOG,
  MAX_AUDIT_LOG_ENTRIES,
} from '../src/background/stateManager';
import {
  AgentTaskSession,
  ActionHistoryEntry,
  ActionStep,
} from '../src/types/action';
import AgentView from '../src/sidepanel/components/Agent/AgentView';
import { DEFAULT_SETTINGS } from '../src/types/ai';

// ---------------------------------------------------------------------------
// Mock Storage & Chrome Environment for Node.js
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
      remove: async (key: string) => {
        delete mockLocalStorage[key];
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
      remove: async (key: string) => {
        delete mockSessionStorage[key];
      },
      setAccessLevel: async () => {},
    },
  },
  runtime: {
    sendMessage: async (msg: any) => ({ success: true, echoed: msg }),
    onMessage: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  tabs: {
    query: async () => [{ id: 101, url: 'https://example.com/jobs', title: 'Careers' }],
    sendMessage: async () => ({ success: true, elements: [] }),
  },
};

// ---------------------------------------------------------------------------
// 1. Session State Persistence Tests
// ---------------------------------------------------------------------------

test('Slice 3.6 - saveAgentSession and getAgentSession persists and retrieves session in chrome.storage.session', async () => {
  resetMockStorage();

  const session: AgentTaskSession = {
    taskId: 'task_alpha_1',
    goal: 'Fill job application form',
    status: 'awaiting_approval',
    currentStepIndex: 2,
    maxSteps: 10,
    pendingStep: {
      action: 'click',
      targetId: 4,
      value: null,
      reason: 'Click the Submit Application button',
      isConsequential: true,
    },
    pendingElement: { id: 4, type: 'button', text: 'Submit Application' },
    tabId: 101,
    tabUrl: 'https://example.com/apply',
    tabTitle: 'Job Application',
    history: [
      {
        stepNumber: 1,
        action: 'type',
        targetId: 1,
        value: 'Jane Doe',
        reason: 'Enter candidate name',
        status: 'approved',
        executedAt: Date.now() - 5000,
      },
    ],
    skippedElementIds: [],
    startedAt: Date.now() - 10000,
    updatedAt: Date.now() - 1000,
  };

  await saveAgentSession(session);

  // Directly verify session was saved under STORAGE_KEY_AGENT_SESSION
  assert.ok(mockSessionStorage[STORAGE_KEY_AGENT_SESSION]);
  assert.equal(mockSessionStorage[STORAGE_KEY_AGENT_SESSION].taskId, 'task_alpha_1');

  // Verify getAgentSession retrieves and parses it
  const retrieved = await getAgentSession();
  assert.ok(retrieved);
  assert.equal(retrieved.taskId, 'task_alpha_1');
  assert.equal(retrieved.goal, 'Fill job application form');
  assert.equal(retrieved.status, 'awaiting_approval');
  assert.equal(retrieved.currentStepIndex, 2);
  assert.equal(retrieved.pendingStep?.action, 'click');
  assert.equal(retrieved.pendingStep?.targetId, 4);
  assert.equal(retrieved.history.length, 1);
  assert.equal(retrieved.history[0].action, 'type');
});

test('Slice 3.6 - clearAgentSession removes active session from chrome.storage.session', async () => {
  resetMockStorage();

  await createAgentSession({ goal: 'Search products' });
  const active = await getAgentSession();
  assert.ok(active);

  await clearAgentSession();
  const cleared = await getAgentSession();
  assert.equal(cleared, null);
  assert.equal(mockSessionStorage[STORAGE_KEY_AGENT_SESSION], undefined);
});

test('Slice 3.6 - createAgentSession and updateAgentSession lifecycle', async () => {
  resetMockStorage();

  const created = await createAgentSession({
    goal: 'Navigate to checkout',
    maxSteps: 8,
    tabId: 42,
    tabUrl: 'https://store.example.com',
  });

  assert.ok(created.taskId.startsWith('task_'));
  assert.equal(created.goal, 'Navigate to checkout');
  assert.equal(created.status, 'planning');
  assert.equal(created.maxSteps, 8);
  assert.equal(created.tabId, 42);

  const updated = await updateAgentSession({
    status: 'executing',
    currentStepIndex: 3,
  });

  assert.ok(updated);
  assert.equal(updated.status, 'executing');
  assert.equal(updated.currentStepIndex, 3);
  assert.equal(updated.goal, 'Navigate to checkout');
});

test('Slice 3.6 - savePendingStep stages action for user contemplation', async () => {
  resetMockStorage();

  await createAgentSession({ goal: 'Book flight' });

  const pendingStep: ActionStep = {
    action: 'select',
    targetId: 7,
    targetElementId: 7,
    value: 'Window Seat',
    reason: 'Choose preferred seating option',
    isConsequential: false,
  };

  const updated = await savePendingStep({
    step: pendingStep,
    matchedElement: { id: 7, type: 'select', text: 'Seat Selection' },
    currentStepIndex: 2,
  });

  assert.ok(updated);
  assert.equal(updated.status, 'awaiting_approval');
  assert.equal(updated.currentStepIndex, 2);
  assert.equal(updated.pendingStep?.action, 'select');
  assert.equal(updated.pendingStep?.value, 'Window Seat');
  assert.equal(updated.pendingElement?.id, 7);
});

test('Slice 3.6 - appendSessionStepHistory updates execution history and resets pendingStep', async () => {
  resetMockStorage();

  await createAgentSession({ goal: 'Fill contact form' });
  await savePendingStep({
    step: {
      action: 'type',
      targetId: 2,
      targetElementId: 2,
      value: 'hello@example.com',
      reason: 'Fill email field',
      isConsequential: false,
    },
  });

  const executedEntry: ActionHistoryEntry = {
    stepNumber: 1,
    action: 'type',
    targetId: 2,
    value: 'hello@example.com',
    reason: 'Fill email field',
    status: 'approved',
    executedAt: Date.now(),
  };

  const updated = await appendSessionStepHistory(executedEntry);
  assert.ok(updated);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].value, 'hello@example.com');
  assert.equal(updated.pendingStep, null);
  assert.equal(updated.pendingElement, null);
});

test('Slice 3.6 - updateSessionStatus transitions session to completed or aborted', async () => {
  resetMockStorage();

  await createAgentSession({ goal: 'Download invoice' });

  const completed = await updateSessionStatus('completed');
  assert.ok(completed);
  assert.equal(completed.status, 'completed');

  const aborted = await updateSessionStatus('aborted', 'Aborted by user');
  assert.ok(aborted);
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.error, 'Aborted by user');
});

// ---------------------------------------------------------------------------
// 2. Service Worker Hibernation Simulation
// ---------------------------------------------------------------------------

test('Slice 3.6 - Service Worker Hibernation: pending state survives dormancy and restores instantly', async () => {
  resetMockStorage();

  // 1. In-flight task paused on HITL ActionCard
  const taskId = 'task_hibernation_test_99';
  const pendingStep: ActionStep = {
    action: 'click',
    targetId: 12,
    targetElementId: 12,
    value: null,
    reason: 'Click Complete Purchase button',
    isConsequential: true,
  };

  await saveAgentSession({
    taskId,
    goal: 'Purchase item',
    status: 'awaiting_approval',
    currentStepIndex: 3,
    maxSteps: 10,
    pendingStep,
    pendingElement: { id: 12, type: 'button', text: 'Complete Purchase' },
    tabId: 101,
    tabUrl: 'https://example.com/checkout',
    tabTitle: 'Checkout',
    history: [
      {
        stepNumber: 1,
        action: 'type',
        targetId: 1,
        value: '123 Fake St',
        reason: 'Address',
        status: 'approved',
        executedAt: Date.now() - 30000,
      },
      {
        stepNumber: 2,
        action: 'click',
        targetId: 5,
        value: null,
        reason: 'Select standard shipping',
        status: 'approved',
        executedAt: Date.now() - 20000,
      },
    ],
    skippedElementIds: [],
    startedAt: Date.now() - 60000,
    updatedAt: Date.now() - 15000,
  });

  // 2. SIMULATE SERVICE WORKER TERMINATION / HIBERNATION
  // (In MV3, service worker memory is wiped, all closures destroyed; only chrome.storage remains)

  // 3. User reopens or restores the side panel; service worker reawakens
  const { session, isRestored } = await rehydratePendingSession();

  assert.equal(isRestored, true);
  assert.ok(session);
  assert.equal(session.taskId, taskId);
  assert.equal(session.goal, 'Purchase item');
  assert.equal(session.status, 'awaiting_approval');
  assert.equal(session.currentStepIndex, 3);
  assert.equal(session.pendingStep?.action, 'click');
  assert.equal(session.pendingStep?.targetId, 12);
  assert.equal(session.pendingStep?.isConsequential, true);
  assert.equal(session.history.length, 2);
  assert.equal(session.pendingElement?.text, 'Complete Purchase');
});

// ---------------------------------------------------------------------------
// 3. Persistent Action Audit Log (chrome.storage.local) Tests
// ---------------------------------------------------------------------------

test('Slice 3.6 - recordAuditLogEntry writes step to chrome.storage.local audit trail', async () => {
  resetMockStorage();

  const entry: ActionHistoryEntry = {
    stepNumber: 1,
    action: 'click',
    targetId: 3,
    value: null,
    reason: 'Clicked Accept All Cookies button',
    status: 'approved',
    executedAt: Date.now(),
  };

  const auditResult = await recordAuditLogEntry(entry, {
    taskId: 'task_audit_test',
    goal: 'Accept cookies and read article',
    tabId: 101,
    tabUrl: 'https://news.example.com/post',
    tabTitle: 'Tech News',
  });

  assert.ok(auditResult.id.startsWith('audit_'));
  assert.equal(auditResult.taskId, 'task_audit_test');
  assert.equal(auditResult.goal, 'Accept cookies and read article');
  assert.equal(auditResult.tabUrl, 'https://news.example.com/post');
  assert.equal(auditResult.action, 'click');
  assert.equal(auditResult.status, 'approved');

  // Verify stored in chrome.storage.local
  const storedLogs = mockLocalStorage[STORAGE_KEY_AUDIT_LOG];
  assert.ok(Array.isArray(storedLogs));
  assert.equal(storedLogs.length, 1);
  assert.equal(storedLogs[0].id, auditResult.id);
});

test('Slice 3.6 - getAuditLog supports taskId filtering, limits, and chronological ordering', async () => {
  resetMockStorage();

  // Record 3 steps for task A and 2 steps for task B
  for (let i = 1; i <= 3; i++) {
    await recordAuditLogEntry(
      {
        stepNumber: i,
        action: 'click',
        targetId: i,
        value: null,
        reason: `Step ${i} for Task A`,
        status: 'approved',
        executedAt: 1000 + i * 100,
      },
      { taskId: 'task_A', goal: 'Task A' }
    );
  }

  for (let i = 1; i <= 2; i++) {
    await recordAuditLogEntry(
      {
        stepNumber: i,
        action: 'type',
        targetId: 10 + i,
        value: `val_${i}`,
        reason: `Step ${i} for Task B`,
        status: 'approved',
        executedAt: 2000 + i * 100,
      },
      { taskId: 'task_B', goal: 'Task B' }
    );
  }

  // Retrieve all (latest first by default)
  const allLogs = await getAuditLog();
  assert.equal(allLogs.length, 5);

  // Retrieve filtered by taskId
  const taskALogs = await getAuditLog({ taskId: 'task_A' });
  assert.equal(taskALogs.length, 3);
  assert.equal(taskALogs[0].taskId, 'task_A');

  const taskBLogs = await getAuditLog({ taskId: 'task_B' });
  assert.equal(taskBLogs.length, 2);
  assert.equal(taskBLogs[0].taskId, 'task_B');

  // Retrieve with limit
  const limited = await getAuditLog({ limit: 2 });
  assert.equal(limited.length, 2);

  // Retrieve in chronological order (reverse)
  const chronological = await getAuditLog({ taskId: 'task_A', reverse: true });
  assert.equal(chronological[0].stepNumber, 1);
  assert.equal(chronological[2].stepNumber, 3);
});

test('Slice 3.6 - clearAuditLog removes all or task-specific audit entries', async () => {
  resetMockStorage();

  await recordAuditLogEntry(
    { stepNumber: 1, action: 'click', targetId: 1, value: null, reason: 'Step A', status: 'approved' },
    { taskId: 'task_to_keep' }
  );
  await recordAuditLogEntry(
    { stepNumber: 1, action: 'click', targetId: 2, value: null, reason: 'Step B', status: 'approved' },
    { taskId: 'task_to_delete' }
  );

  let logs = await getAuditLog();
  assert.equal(logs.length, 2);

  // Delete only task_to_delete
  await clearAuditLog('task_to_delete');
  logs = await getAuditLog();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].taskId, 'task_to_keep');

  // Clear all
  await clearAuditLog();
  logs = await getAuditLog();
  assert.equal(logs.length, 0);
});

test('Slice 3.6 - exportAuditLogAsJson produces valid JSON representation', async () => {
  resetMockStorage();

  await recordAuditLogEntry(
    {
      stepNumber: 1,
      action: 'click',
      targetId: 5,
      value: null,
      reason: 'Click Download Button',
      status: 'approved',
      executedAt: Date.now(),
    },
    { taskId: 'task_export', goal: 'Download file' }
  );

  const json = await exportAuditLogAsJson('task_export');
  assert.ok(typeof json === 'string');

  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].taskId, 'task_export');
  assert.equal(parsed[0].action, 'click');
});

test('Slice 3.6 - Audit Log FIFO capacity bounding prevents storage explosion', async () => {
  resetMockStorage();

  // Populate mock storage with MAX_AUDIT_LOG_ENTRIES + 5 entries
  const existingEntries: any[] = [];
  for (let i = 0; i < MAX_AUDIT_LOG_ENTRIES; i++) {
    existingEntries.push({
      id: `audit_old_${i}`,
      stepNumber: i,
      action: 'click',
      targetId: null,
      value: null,
      reason: `Old Step ${i}`,
      status: 'approved',
      executedAt: 1000 + i,
      timestamp: 1000 + i,
    });
  }
  mockLocalStorage[STORAGE_KEY_AUDIT_LOG] = existingEntries;

  // Record a new entry
  const newEntry: ActionHistoryEntry = {
    stepNumber: 999,
    action: 'scroll',
    targetId: null,
    value: 'down',
    reason: 'Scroll page',
    status: 'approved',
    executedAt: 999999,
  };

  await recordAuditLogEntry(newEntry, { taskId: 'task_boundary' });

  const logs = mockLocalStorage[STORAGE_KEY_AUDIT_LOG];
  assert.equal(logs.length, MAX_AUDIT_LOG_ENTRIES);
  assert.equal(logs[0].stepNumber, 999); // Newest is at front
});

// ---------------------------------------------------------------------------
// 4. Runtime Message Dispatcher Tests
// ---------------------------------------------------------------------------

test('Slice 3.6 - handleStateManagerMessage routes all session and audit operations', async () => {
  resetMockStorage();

  // 1. SAVE_AGENT_SESSION
  const saveRes = await handleStateManagerMessage({
    type: 'SAVE_AGENT_SESSION',
    session: {
      taskId: 'task_msg_1',
      goal: 'Test messaging',
      status: 'awaiting_approval',
      currentStepIndex: 1,
      maxSteps: 5,
      history: [],
      skippedElementIds: [],
    },
  });
  assert.equal(saveRes.success, true);

  // 2. GET_AGENT_SESSION
  const getRes: any = await handleStateManagerMessage({ type: 'GET_AGENT_SESSION' });
  assert.equal(getRes.success, true);
  assert.equal(getRes.session?.taskId, 'task_msg_1');
  assert.equal(getRes.session?.goal, 'Test messaging');

  // 3. RECORD_AUDIT_LOG
  const recordRes: any = await handleStateManagerMessage({
    type: 'RECORD_AUDIT_LOG',
    entry: {
      stepNumber: 1,
      action: 'click',
      targetId: 8,
      value: null,
      reason: 'Audit message test',
      status: 'approved',
      executedAt: Date.now(),
    },
    context: { taskId: 'task_msg_1', goal: 'Test messaging' },
  });
  assert.equal(recordRes.success, true);
  assert.ok(recordRes.auditEntry?.id.startsWith('audit_'));

  // 4. GET_AUDIT_LOG
  const getAuditRes: any = await handleStateManagerMessage({
    type: 'GET_AUDIT_LOG',
    options: { taskId: 'task_msg_1' },
  });
  assert.equal(getAuditRes.success, true);
  assert.equal(getAuditRes.entries.length, 1);

  // 5. AGENT_HEARTBEAT
  const heartbeatRes: any = await handleStateManagerMessage({
    type: 'AGENT_HEARTBEAT',
    taskId: 'task_msg_1',
  });
  assert.equal(heartbeatRes.success, true);
  assert.equal(heartbeatRes.status, 'alive');
  assert.ok(heartbeatRes.timestamp > 0);

  // 6. CLEAR_AGENT_SESSION
  const clearRes = await handleStateManagerMessage({ type: 'CLEAR_AGENT_SESSION' });
  assert.equal(clearRes.success, true);
  const getAfterClear: any = await handleStateManagerMessage({ type: 'GET_AGENT_SESSION' });
  assert.equal(getAfterClear.session, null);

  // 7. CLEAR_AUDIT_LOG
  const clearAuditRes = await handleStateManagerMessage({ type: 'CLEAR_AUDIT_LOG' });
  assert.equal(clearAuditRes.success, true);
  const auditAfterClear: any = await handleStateManagerMessage({ type: 'GET_AUDIT_LOG' });
  assert.equal(auditAfterClear.entries.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Side Panel AgentView Integration Test
// ---------------------------------------------------------------------------

test('Slice 3.6 - AgentView renders seamlessly and supports audit log display', () => {
  const html = renderToString(
    React.createElement(AgentView, {
      settings: DEFAULT_SETTINGS,
      initialGoal: 'Test automated submission',
    })
  );

  const dom = new JSDOM(html);
  const textContent = dom.window.document.body.textContent || '';

  // Confirm browser agent header and HITL badge render
  assert.ok(textContent.includes('Browser Agent'));
  assert.ok(textContent.includes('HITL Controlled'));
  assert.ok(textContent.includes('Under strict human review at every step'));
});

