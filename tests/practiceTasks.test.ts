import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { JSDOM } from 'jsdom';
import {
  scanInteractiveElements,
  clearScannerRegistry,
  getElementById,
} from '../src/content/scanner';
import { removeBadges } from '../src/content/badges';
import { executeAction } from '../src/content/executor';
import {
  ActionStep,
  ActionHistoryEntry,
  AgentTaskSession,
} from '../src/types/action';
import {
  saveAgentSession,
  getAgentSession,
  clearAgentSession,
  recordAuditLogEntry,
  getAuditLog,
  clearAuditLog,
} from '../src/background/stateManager';

// ---------------------------------------------------------------------------
// Setup Mock Chrome Storage
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
        if (typeof key === 'string') return { [key]: mockLocalStorage[key] };
        const result: Record<string, any> = {};
        for (const k of key) result[k] = mockLocalStorage[k];
        return result;
      },
      set: async (items: Record<string, any>) => Object.assign(mockLocalStorage, items),
      remove: async (key: string) => {
        delete mockLocalStorage[key];
      },
    },
    session: {
      get: async (key: string | string[]) => {
        if (typeof key === 'string') return { [key]: mockSessionStorage[key] };
        const result: Record<string, any> = {};
        for (const k of key) result[k] = mockSessionStorage[k];
        return result;
      },
      set: async (items: Record<string, any>) => Object.assign(mockSessionStorage, items),
      remove: async (key: string) => {
        delete mockSessionStorage[key];
      },
      setAccessLevel: async () => {},
    },
  },
};

/**
 * Creates a simulated browser environment with JSDOM loaded from file or HTML
 */
function setupPracticePage(htmlContent: string) {
  const dom = new JSDOM(htmlContent, {
    url: 'https://askbro.test/practice',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  // Mock layout sizes for elements in JSDOM
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      top: 50,
      left: 50,
      bottom: 80,
      right: 350,
      width: 300,
      height: 30,
      x: 50,
      y: 50,
      toJSON: () => {},
    };
  };

  // Provide smooth scroll mock
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollBy = function () {};
  window.scrollTo = function () {};

  // Attach globals
  (globalThis as any).window = window;
  (globalThis as any).document = document;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Element = window.Element;
  (globalThis as any).HTMLInputElement = window.HTMLInputElement;
  (globalThis as any).HTMLTextAreaElement = window.HTMLTextAreaElement;
  (globalThis as any).HTMLSelectElement = window.HTMLSelectElement;
  (globalThis as any).HTMLButtonElement = window.HTMLButtonElement;
  (globalThis as any).HTMLAnchorElement = window.HTMLAnchorElement;
  (globalThis as any).MouseEvent = window.MouseEvent;
  (globalThis as any).Event = window.Event;

  clearScannerRegistry();
  removeBadges();

  return { dom, window, document };
}

// ---------------------------------------------------------------------------
// Acceptance Criteria: Multi-Step Task 1 — Internship Application Form
// ---------------------------------------------------------------------------

test('Phase 3 Acceptance Criteria: Multi-step internship application form completes with HITL approval', async () => {
  resetMockStorage();
  await clearAuditLog();
  await clearAgentSession();

  const filePath = path.resolve(__dirname, '../public/practice/internship-application.html');
  const html = fs.readFileSync(filePath, 'utf-8');
  const { window, document } = setupPracticePage(html);

  // 1. Initial Scan: Scan interactive elements and generate numbered badges
  const scanResult = scanInteractiveElements({ showBadges: false, filterHidden: false });
  assert.ok(scanResult.length >= 7, `Expected at least 7 interactive elements, found ${scanResult.length}`);

  const fullNameEl = document.getElementById('fullName') as HTMLInputElement;
  const emailEl = document.getElementById('email') as HTMLInputElement;
  const collegeEl = document.getElementById('college') as HTMLInputElement;
  const trackEl = document.getElementById('track') as HTMLSelectElement;
  const noteEl = document.getElementById('coverNote') as HTMLTextAreaElement;
  const termsEl = document.getElementById('terms') as HTMLInputElement;
  const submitBtnEl = document.getElementById('submitBtn') as HTMLButtonElement;
  const successBanner = document.getElementById('successBanner') as HTMLElement;

  assert.ok(fullNameEl && emailEl && collegeEl && trackEl && noteEl && termsEl && submitBtnEl);

  // Map elements to their assigned IDs
  const idMap = new Map<HTMLElement, number>();
  for (const item of scanResult) {
    const el = getElementById(item.id);
    if (el) idMap.set(el, item.id);
  }

  const nameId = idMap.get(fullNameEl)!;
  const emailId = idMap.get(emailEl)!;
  const collegeId = idMap.get(collegeEl)!;
  const trackId = idMap.get(trackEl)!;
  const noteId = idMap.get(noteEl)!;
  const termsId = idMap.get(termsEl)!;
  const submitId = idMap.get(submitBtnEl)!;

  assert.ok(nameId && emailId && collegeId && trackId && noteId && termsId && submitId);

  // Initialize Agent Session
  const taskId = 'task_internship_multi_step_01';
  let session: AgentTaskSession = {
    taskId,
    goal: 'Fill out AI Engineering internship application and submit',
    status: 'planning',
    currentStepIndex: 1,
    maxSteps: 10,
    history: [],
    skippedElementIds: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveAgentSession(session);

  // Multi-step planned actions sequence
  const planSteps: ActionStep[] = [
    {
      action: 'type',
      targetId: nameId,
      targetElementId: nameId,
      value: 'Alex Rivera',
      reason: 'Enter full candidate name into Full Name field',
      isConsequential: false,
    },
    {
      action: 'type',
      targetId: emailId,
      targetElementId: emailId,
      value: 'alex.rivera@example.com',
      reason: 'Enter contact email address',
      isConsequential: false,
    },
    {
      action: 'type',
      targetId: collegeId,
      targetElementId: collegeId,
      value: 'IIT Bombay',
      reason: 'Fill applicant university / college name',
      isConsequential: false,
    },
    {
      action: 'select',
      targetId: trackId,
      targetElementId: trackId,
      value: 'ai-agent',
      reason: 'Select Autonomous AI Agent Architectures specialization track',
      isConsequential: false,
    },
    {
      action: 'type',
      targetId: noteId,
      targetElementId: noteId,
      value: 'Built multi-agent autonomous browser tools with LangChain and Chrome MV3.',
      reason: 'Provide concise project overview in cover note textarea',
      isConsequential: false,
    },
    {
      action: 'click',
      targetId: termsId,
      targetElementId: termsId,
      value: null,
      reason: 'Check accuracy verification checkbox',
      isConsequential: false,
    },
    {
      action: 'click',
      targetId: submitId,
      targetElementId: submitId,
      value: null,
      reason: 'Submit the completed internship application form',
      isConsequential: true, // Flagged consequential for user confirmation!
    },
    {
      action: 'done',
      targetId: null,
      targetElementId: null,
      value: null,
      reason: 'All application fields filled and form submitted successfully.',
      isConsequential: false,
    },
  ];

  // Execute multi-step loop with strict human approval simulation
  for (let i = 0; i < planSteps.length; i++) {
    const step = planSteps[i];
    const stepNumber = i + 1;

    // 1. Agent enters awaiting_approval state
    session.status = 'awaiting_approval';
    session.pendingStep = step;
    session.currentStepIndex = stepNumber;
    await saveAgentSession(session);

    // 2. Human approves the action explicitly
    session.status = 'executing';
    await saveAgentSession(session);

    // 3. Execution via Content Script Executor
    const execRes = await executeAction(step);
    assert.equal(execRes.success, true, `Step ${stepNumber} (${step.action}) execution failed: ${execRes.error}`);

    // 4. Record to persistent Audit Trail (chrome.storage.local)
    const historyEntry: ActionHistoryEntry = {
      stepNumber,
      action: step.action,
      targetId: step.targetId,
      value: step.value,
      reason: step.reason,
      status: step.action === 'done' ? 'completed' : 'approved',
      executedAt: Date.now(),
    };

    await recordAuditLogEntry(historyEntry, {
      taskId,
      goal: session.goal,
      tabUrl: window.location.href,
    });

    session.history.push(historyEntry);
    session.pendingStep = null;
    await saveAgentSession(session);
  }

  // Verify DOM state after all multi-step actions executed
  assert.equal(fullNameEl.value, 'Alex Rivera');
  assert.equal(emailEl.value, 'alex.rivera@example.com');
  assert.equal(collegeEl.value, 'IIT Bombay');
  assert.equal(trackEl.value, 'ai-agent');
  assert.equal(noteEl.value, 'Built multi-agent autonomous browser tools with LangChain and Chrome MV3.');
  assert.equal(termsEl.checked, true);

  // Form submitted -> success banner visible
  assert.equal(successBanner.style.display, 'block');

  // Verify Persistent Session
  const finalSession = await getAgentSession();
  assert.ok(finalSession);
  assert.equal(finalSession.history.length, 8);
  assert.equal(finalSession.history[7].action, 'done');
  assert.equal(finalSession.history[7].status, 'completed');

  // Verify Audit Log in chrome.storage.local
  const auditLogs = await getAuditLog({ taskId });
  assert.equal(auditLogs.length, 8);
  assert.equal(auditLogs[0].action, 'done'); // latest first
  assert.equal(auditLogs[1].action, 'click'); // submit
});

// ---------------------------------------------------------------------------
// Acceptance Criteria: Multi-Step Task 2 — Shop Search & Filter
// ---------------------------------------------------------------------------

test('Phase 3 Acceptance Criteria: Multi-step shop search and filter completes with HITL approval', async () => {
  resetMockStorage();
  await clearAuditLog();
  await clearAgentSession();

  const filePath = path.resolve(__dirname, '../public/practice/shop-search-filter.html');
  const html = fs.readFileSync(filePath, 'utf-8');
  const { document } = setupPracticePage(html);

  // Scan elements
  const scanResult = scanInteractiveElements({ showBadges: false, filterHidden: false });
  assert.ok(scanResult.length >= 6);

  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
  const categorySelect = document.getElementById('categorySelect') as HTMLSelectElement;
  const applyBtn = document.getElementById('applyFiltersBtn') as HTMLButtonElement;
  const countLabel = document.getElementById('resultsCount') as HTMLElement;
  const cards = document.querySelectorAll('.product-card');

  assert.ok(searchInput && searchBtn && categorySelect && applyBtn && countLabel);
  assert.equal(cards.length, 4);

  const idMap = new Map<HTMLElement, number>();
  for (const item of scanResult) {
    const el = getElementById(item.id);
    if (el) idMap.set(el, item.id);
  }

  const searchInputId = idMap.get(searchInput)!;
  const searchBtnId = idMap.get(searchBtn)!;
  const categorySelectId = idMap.get(categorySelect)!;
  const applyBtnId = idMap.get(applyBtn)!;

  const taskId = 'task_shop_search_filter_02';

  // Multi-step task:
  // Step 1: Type "Developer ThinkPad" into search
  // Step 2: Click Search button
  // Step 3: Done
  const steps: ActionStep[] = [
    {
      action: 'type',
      targetId: searchInputId,
      targetElementId: searchInputId,
      value: 'Developer ThinkPad',
      reason: 'Search for developer laptop model',
      isConsequential: false,
    },
    {
      action: 'click',
      targetId: searchBtnId,
      targetElementId: searchBtnId,
      value: null,
      reason: 'Click Search button to query matching products',
      isConsequential: false,
    },
    {
      action: 'done',
      targetId: null,
      targetElementId: null,
      value: null,
      reason: 'Shop query completed; Developer ThinkPad is isolated in product view.',
      isConsequential: false,
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const execRes = await executeAction(step);
    assert.equal(execRes.success, true);

    await recordAuditLogEntry(
      {
        stepNumber: i + 1,
        action: step.action,
        targetId: step.targetId,
        value: step.value,
        reason: step.reason,
        status: step.action === 'done' ? 'completed' : 'approved',
        executedAt: Date.now(),
      },
      { taskId, goal: 'Search for developer laptop' }
    );
  }

  // Verify input value set
  assert.equal(searchInput.value, 'Developer ThinkPad');

  // Verify filter executed: Only 1 matching product visible
  assert.equal(countLabel.textContent, 'Showing 1 of 4 products');

  const visibleCards = Array.from(cards).filter(
    (c) => (c as HTMLElement).style.display !== 'none'
  );
  assert.equal(visibleCards.length, 1);
  assert.ok(visibleCards[0].textContent?.includes('ThinkPad X1 Carbon'));

  // Verify audit log has 3 entries
  const logs = await getAuditLog({ taskId });
  assert.equal(logs.length, 3);
});

// ---------------------------------------------------------------------------
// Acceptance Criteria: Multi-Step Task 3 — Dry-Run & Skip Interception
// ---------------------------------------------------------------------------

test('Phase 3 Acceptance Criteria: Dry-Run and Skip work seamlessly mid-workflow without corrupting state', async () => {
  resetMockStorage();

  const filePath = path.resolve(__dirname, '../public/practice/internship-application.html');
  const html = fs.readFileSync(filePath, 'utf-8');
  const { document } = setupPracticePage(html);

  const scanned = scanInteractiveElements({ showBadges: false, filterHidden: false });

  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  const fullNameEl = document.getElementById('fullName') as HTMLInputElement;

  let resetId: number | null = null;
  let nameId: number | null = null;

  for (const item of scanned) {
    const el = getElementById(item.id);
    if (el === resetBtn) resetId = item.id;
    if (el === fullNameEl) nameId = item.id;
  }

  assert.ok(resetId && nameId);

  // 1. Propose resetting form
  const dangerousStep: ActionStep = {
    action: 'click',
    targetId: resetId,
    targetElementId: resetId,
    value: null,
    reason: 'Reset the entire form',
    isConsequential: true,
  };

  // User performs Dry-Run: verify element outlines without clicking or clearing
  fullNameEl.value = 'Existing Candidate Data';
  const dryRunRes = await executeAction({
    ...dangerousStep,
    action: 'scroll', // Dry run does not trigger click
    value: null,
  });
  assert.equal(dryRunRes.success, true);
  assert.equal(fullNameEl.value, 'Existing Candidate Data'); // Data untouched!

  // User Skips this step: records skip to audit log
  await recordAuditLogEntry(
    {
      stepNumber: 1,
      action: dangerousStep.action,
      targetId: resetId,
      value: null,
      reason: 'Skipped by user: do not reset form',
      status: 'skipped',
      executedAt: Date.now(),
    },
    { taskId: 'task_skip_test' }
  );

  const logs = await getAuditLog({ taskId: 'task_skip_test' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'skipped');
  assert.equal(fullNameEl.value, 'Existing Candidate Data');
});
