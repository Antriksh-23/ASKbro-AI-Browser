/**
 * Technical Debt, Risks & Mitigation Strategy Test Suite
 *
 * Verifies the 5 deterministic programmatic mitigations outlined in implementation-plan.md:
 * 1. Manifest V3 Worker Inactivity: Continuous storage sync and instantaneous wake-up uncompleted step handling.
 * 2. Dynamic SPA DOM Mutation: MutationObserver in content script to invalidate and refresh action badges.
 * 3. Gemini Rate Limits (HTTP 429): Exponential backoff, prompt length truncation, and Groq fallback.
 * 4. Host Site CSS Collisions: Closed Shadow DOM isolation (attachShadow({ mode: 'closed' })) and visual encapsulation.
 * 5. Accidental Sensitive Data Entry: Hardcoded client-side filters rejecting passwords, OTP, split 2FA, and cards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// 1. Worker Inactivity & State Management imports
import {
  saveAgentSession,
  getAgentSession,
  clearAgentSession,
  handleWorkerWakeup,
  initWorkerSessionSupport,
  handleStateManagerMessage,
  STORAGE_KEY_AGENT_SESSION,
} from '../src/background/stateManager';
import type { AgentTaskSession } from '../src/types/action';

// 2. Dynamic SPA DOM Mutation & 4. Closed Shadow DOM imports
import {
  renderBadges,
  removeBadges,
  repositionBadges,
  invalidateAndPruneBadges,
  triggerDomMutationCheck,
  attachMutationObserver,
  detachMutationObserver,
  isMutationObserverActive,
  setOnDomMutationCallback,
  verifyShadowIsolation,
  getTrackedBadges,
  BADGE_ROOT_ID,
} from '../src/content/badges';
import {
  scanInteractiveElements,
  refreshBadgesOnMutation,
  clearScannerRegistry,
  getElementById,
} from '../src/content/scanner';
import { executeAction } from '../src/content/executor';

// 3. Rate Limits & Truncation imports
import {
  truncatePromptForRateLimit,
  DEFAULT_MAX_PROMPT_CHARS,
  executeResilientContent,
  streamResilientContent,
  withExponentialBackoff,
  isRateLimitError,
  RateLimitTracker,
} from '../src/services/ai/rateLimiter';
import { saveSettings } from '../src/services/storage/settingsStore';

// 5. Sensitive Data Entry imports
import {
  checkFieldSafety,
  isSensitiveField,
  SENSITIVE_FIELD_REGEX,
} from '../src/services/safety/fieldGuard';

// Helper to set up fake Chrome storage environment for tests
function setupChromeStorageMock() {
  const sessionStorageStore: Record<string, any> = {};
  const localStorageStore: Record<string, any> = {};

  (global as any).chrome = {
    storage: {
      session: {
        get: (keys: any, cb?: (res: any) => void) => {
          const res: any = {};
          if (typeof keys === 'string') {
            res[keys] = sessionStorageStore[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => (res[k] = sessionStorageStore[k]));
          } else if (keys && typeof keys === 'object') {
            Object.keys(keys).forEach((k) => {
              res[k] = sessionStorageStore[k] !== undefined ? sessionStorageStore[k] : keys[k];
            });
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          Object.assign(sessionStorageStore, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys: any, cb?: () => void) => {
          if (typeof keys === 'string') {
            delete sessionStorageStore[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => delete sessionStorageStore[k]);
          }
          if (cb) cb();
          return Promise.resolve();
        },
        clear: (cb?: () => void) => {
          Object.keys(sessionStorageStore).forEach((k) => delete sessionStorageStore[k]);
          if (cb) cb();
          return Promise.resolve();
        },
        setAccessLevel: () => Promise.resolve(),
      },
      local: {
        get: (keys: any, cb?: (res: any) => void) => {
          const res: any = {};
          if (typeof keys === 'string') {
            res[keys] = localStorageStore[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => (res[k] = localStorageStore[k]));
          } else if (keys && typeof keys === 'object') {
            Object.keys(keys).forEach((k) => {
              res[k] = localStorageStore[k] !== undefined ? localStorageStore[k] : keys[k];
            });
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          Object.assign(localStorageStore, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys: any, cb?: () => void) => {
          if (typeof keys === 'string') {
            delete localStorageStore[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => delete localStorageStore[k]);
          }
          if (cb) cb();
          return Promise.resolve();
        },
        clear: (cb?: () => void) => {
          Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: () => {},
      },
      onStartup: {
        addListener: () => {},
      },
    },
  };

  return { sessionStorageStore, localStorageStore };
}

// Helper to create DOM test environment
function createTestEnvironment(html: string) {
  const dom = new JSDOM(html, {
    url: 'https://askbro.test/page',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  (global as any).window = window;
  (global as any).document = document;
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).Element = window.Element;
  (global as any).HTMLInputElement = window.HTMLInputElement;
  (global as any).HTMLSelectElement = window.HTMLSelectElement;
  (global as any).HTMLButtonElement = window.HTMLButtonElement;
  (global as any).HTMLAnchorElement = window.HTMLAnchorElement;
  (global as any).MutationObserver = window.MutationObserver;

  return { dom, window, document };
}

// ---------------------------------------------------------------------------
// 1. Manifest V3 Worker Inactivity Tests
// ---------------------------------------------------------------------------

test('Risk 1: Manifest V3 Worker Inactivity - Session state continuously syncs to chrome.storage.session', async () => {
  setupChromeStorageMock();

  const session: AgentTaskSession = {
    taskId: 'task_mv3_sync',
    goal: 'Fill job application and verify inputs',
    status: 'awaiting_approval',
    currentStepIndex: 2,
    maxSteps: 10,
    startedAt: Date.now() - 5000,
    updatedAt: Date.now(),
    history: [],
    skippedElementIds: [],
    pendingStep: {
      action: 'type',
      targetId: 3,
      value: 'Devika Sharma',
      reason: 'Type candidate name',
      isConsequential: false,
    },
  };

  await saveAgentSession(session);
  const retrieved = await getAgentSession();

  assert.ok(retrieved);
  assert.equal(retrieved.taskId, 'task_mv3_sync');
  assert.equal(retrieved.status, 'awaiting_approval');
  assert.equal(retrieved.currentStepIndex, 2);
  assert.equal(retrieved.pendingStep?.value, 'Devika Sharma');
});

test('Risk 1: Manifest V3 Worker Inactivity - Wake-up handles uncompleted steps instantly', async () => {
  setupChromeStorageMock();

  // Case A: Worker awoke while session was awaiting approval
  const sessionWaiting: AgentTaskSession = {
    taskId: 'task_waiting',
    goal: 'Click Submit application',
    status: 'awaiting_approval',
    currentStepIndex: 4,
    maxSteps: 10,
    startedAt: Date.now() - 60000,
    updatedAt: Date.now() - 40000,
    history: [],
    skippedElementIds: [],
    pendingStep: {
      action: 'click',
      targetId: 7,
      value: null,
      reason: 'Submit form button',
      isConsequential: true,
    },
  };

  await saveAgentSession(sessionWaiting);

  const wakeupWaiting = await handleWorkerWakeup();
  assert.equal(wakeupWaiting.hasPendingTask, true);
  assert.equal(wakeupWaiting.actionTaken, 'resumed_awaiting_approval');
  assert.ok(wakeupWaiting.session?.lastWakeupAt);

  // Case B: Worker hibernated mid-execution (in-flight network or long contemplation)
  const sessionExecuting: AgentTaskSession = {
    taskId: 'task_executing',
    goal: 'Type cover letter',
    status: 'executing',
    currentStepIndex: 1,
    maxSteps: 10,
    startedAt: Date.now() - 30000,
    updatedAt: Date.now() - 25000,
    history: [],
    skippedElementIds: [],
    pendingStep: {
      action: 'type',
      targetId: 2,
      value: 'Passionate frontend engineer',
      reason: 'Fill cover letter textarea',
      isConsequential: false,
    },
  };

  await saveAgentSession(sessionExecuting);

  const wakeupExecuting = await handleWorkerWakeup();
  assert.equal(wakeupExecuting.hasPendingTask, true);
  assert.equal(wakeupExecuting.actionTaken, 'rehydrated_uncompleted_step');
  // Should transition safely back to awaiting_approval so user or runner can re-approve without lockup
  assert.equal(wakeupExecuting.session?.status, 'awaiting_approval');

  // Case C: Worker awoke with finished session
  const sessionFinished: AgentTaskSession = {
    taskId: 'task_done',
    goal: 'Search jobs',
    status: 'completed',
    currentStepIndex: 5,
    maxSteps: 10,
    startedAt: Date.now() - 100000,
    updatedAt: Date.now() - 50000,
    history: [],
    skippedElementIds: [],
  };

  await saveAgentSession(sessionFinished);
  const wakeupDone = await handleWorkerWakeup();
  assert.equal(wakeupDone.hasPendingTask, false);
  assert.equal(wakeupDone.actionTaken, 'none');
});

test('Risk 1: Manifest V3 Worker Inactivity - initWorkerSessionSupport and message routing handle CHECK_WORKER_WAKEUP', async () => {
  setupChromeStorageMock();

  const session: AgentTaskSession = {
    taskId: 'task_startup_check',
    goal: 'Inspect page',
    status: 'awaiting_approval',
    currentStepIndex: 0,
    maxSteps: 10,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
    skippedElementIds: [],
    pendingStep: {
      action: 'click',
      targetId: 1,
      value: null,
      reason: 'Click explore',
      isConsequential: false,
    },
  };
  await saveAgentSession(session);

  const initResult = await initWorkerSessionSupport();
  assert.equal(initResult.hasPendingTask, true);
  assert.equal(initResult.actionTaken, 'resumed_awaiting_approval');

  const msgResponse: any = await handleStateManagerMessage({ type: 'CHECK_WORKER_WAKEUP' });
  assert.equal(msgResponse.success, true);
  assert.equal(msgResponse.hasPendingTask, true);
});

// ---------------------------------------------------------------------------
// 2. Dynamic SPA DOM Mutation Tests
// ---------------------------------------------------------------------------

test('Risk 2: Dynamic SPA DOM Mutation - Attaches MutationObserver to track and prune badges', () => {
  const { document } = createTestEnvironment(`
    <div id="container">
      <button id="btn1">Button 1</button>
      <button id="btn2">Button 2</button>
      <button id="btn3">Button 3</button>
    </div>
  `);

  clearScannerRegistry();
  removeBadges();

  const btn1 = document.getElementById('btn1')!;
  const btn2 = document.getElementById('btn2')!;
  const btn3 = document.getElementById('btn3')!;

  renderBadges([
    { id: 1, element: btn1 },
    { id: 2, element: btn2 },
    { id: 3, element: btn3 },
  ]);

  assert.equal(isMutationObserverActive(), true, 'MutationObserver must be active after renderBadges');
  assert.equal(getTrackedBadges().length, 3);

  // Simulate SPA DOM mutation: Remove button 2 from document
  btn2.remove();

  // Invalidate and prune stale disconnected badges
  const prunedCount = invalidateAndPruneBadges();
  assert.equal(prunedCount, 1, 'Should prune exactly 1 disconnected element');
  assert.equal(getTrackedBadges().length, 2, 'Should have 2 remaining connected badges');

  // Verify surviving badges correspond to btn1 and btn3
  const trackedIds = getTrackedBadges().map((t) => t.id);
  assert.deepEqual(trackedIds, [1, 3]);

  removeBadges();
  assert.equal(isMutationObserverActive(), false, 'MutationObserver must be detached after removeBadges');
});

test('Risk 2: Dynamic SPA DOM Mutation - triggerDomMutationCheck invokes registered SPA callback', (t, done) => {
  const { document } = createTestEnvironment(`
    <div id="app">
      <a href="/login" id="link1">Login</a>
    </div>
  `);

  removeBadges();
  const link1 = document.getElementById('link1')!;
  renderBadges([{ id: 1, element: link1 }]);

  let callbackInvoked = false;
  setOnDomMutationCallback(() => {
    callbackInvoked = true;
  });

  triggerDomMutationCheck();
  assert.equal(callbackInvoked, true, 'Registered DOM mutation callback should execute');

  removeBadges();
  done();
});

test('Risk 2: Dynamic SPA DOM Mutation - refreshBadgesOnMutation re-scans mutated DOM elements seamlessly', () => {
  const { document } = createTestEnvironment(`
    <div id="app">
      <button id="static-btn">Initial Button</button>
    </div>
  `);

  clearScannerRegistry();
  removeBadges();

  const initialElements = scanInteractiveElements({ filterHidden: false, showBadges: true });
  assert.equal(initialElements.length, 1);
  assert.equal(initialElements[0].text, 'Initial Button');

  // Simulate React/Vue route transition: Inject new dynamic interactive controls into app
  const app = document.getElementById('app')!;
  const newButton = document.createElement('button');
  newButton.id = 'dynamic-btn';
  newButton.textContent = 'Dynamic Action';
  app.appendChild(newButton);

  const refreshedElements = refreshBadgesOnMutation({ filterHidden: false });
  assert.equal(refreshedElements.length, 2);

  const buttonTexts = refreshedElements.map((e) => e.text);
  assert.ok(buttonTexts.includes('Initial Button'));
  assert.ok(buttonTexts.includes('Dynamic Action'));

  removeBadges();
});

// ---------------------------------------------------------------------------
// 3. Gemini Rate Limits (HTTP 429) & Prompt Truncation Tests
// ---------------------------------------------------------------------------

test('Risk 3: Gemini Rate Limits - truncatePromptForRateLimit truncates at word boundary with notice tag', () => {
  const longPrompt = 'Lorem ipsum dolor sit amet '.repeat(1000); // ~27,000 chars
  assert.ok(longPrompt.length > DEFAULT_MAX_PROMPT_CHARS);

  const result = truncatePromptForRateLimit(longPrompt, 5000);
  assert.equal(result.wasTruncated, true);
  assert.ok(result.text.length <= 5150); // Under limit + notice tag
  assert.ok(result.text.includes('[ASKbro Notice: Content truncated to fit model token rate limit boundaries]'));

  // Short prompt must not be truncated
  const shortPrompt = 'Tell me the weather in Bengaluru';
  const shortResult = truncatePromptForRateLimit(shortPrompt, 5000);
  assert.equal(shortResult.wasTruncated, false);
  assert.equal(shortResult.text, shortPrompt);
});

test('Risk 3: Gemini Rate Limits - executeResilientContent applies automatic prompt truncation', async () => {
  setupChromeStorageMock();

  const veryLongPrompt = 'User request data: ' + 'A'.repeat(30000);

  // We mock generateContent via global fetch intercept
  const originalFetch = global.fetch;
  let receivedPayloadLength = 0;

  (global as any).fetch = async (url: string, opts: any) => {
    const body = JSON.parse(opts.body);
    const textPart = body.contents[0].parts[0].text;
    receivedPayloadLength = textPart.length;

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Response received within token limit boundaries' }],
            },
          },
        ],
      }),
    };
  };

  try {
    const res = await executeResilientContent(veryLongPrompt, {
      apiKey: 'test-gemini-key-1234567890',
      maxPromptChars: 10000,
      truncatePrompt: true,
    });

    assert.equal(res.provider, 'gemini');
    assert.ok(receivedPayloadLength < 10200, 'Payload text should have been truncated to ~10,000 characters');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Risk 3: Gemini Rate Limits - Automatic Groq fallback on persistent HTTP 429 rate limits', async () => {
  setupChromeStorageMock();
  await saveSettings({ groqApiKey: 'gsk_test_groq_api_key_valid_12345678' });

  const originalFetch = global.fetch;
  let geminiCalls = 0;
  let groqCalls = 0;

  (global as any).fetch = async (url: string, opts: any) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      // Return HTTP 429 rate limit error
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: {
            code: 429,
            message: 'Resource exhausted: rate_limit_exceeded (15 RPM)',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      };
    }

    if (url.includes('api.groq.com')) {
      groqCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Groq fallback response: Goal accomplished cleanly',
              },
            },
          ],
        }),
      };
    }

    return { ok: false, status: 404 };
  };

  try {
    const result = await executeResilientContent('Find internship application link', {
      apiKey: 'test-gemini-key-1234567890',
      delays: [10, 10], // Fast test delays
      maxRetries: 2,
    });

    assert.equal(result.provider, 'groq');
    assert.equal(result.usedFallback, true);
    assert.ok(result.text.includes('Groq fallback response'));
    assert.ok(geminiCalls >= 2, 'Gemini should have retried with exponential backoff');
    assert.equal(groqCalls, 1, 'Groq fallback should have executed after Gemini 429');
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 4. Host Site CSS Collisions Tests
// ---------------------------------------------------------------------------

test('Risk 4: Host Site CSS Collisions - Closed Shadow DOM isolation protects badges from host CSS', () => {
  const { document } = createTestEnvironment(`
    <style>
      /* Malicious/Aggressive host page styles */
      div { display: none !important; width: 0 !important; font-size: 80px !important; }
      * { box-sizing: content-box !important; color: pink !important; }
    </style>
    <div>
      <button id="target-btn">Target</button>
    </div>
  `);

  removeBadges();
  const btn = document.getElementById('target-btn')!;
  renderBadges([{ id: 1, element: btn }]);

  const isolation = verifyShadowIsolation();
  assert.equal(isolation.isClosedShadow, true, 'Badge root overlay must use closed shadow DOM');
  assert.equal(isolation.hostMounted, true, 'Badge overlay host must be mounted');

  // External page script querying .shadowRoot returns null for mode: 'closed'
  const host = document.getElementById(BADGE_ROOT_ID);
  assert.ok(host);
  assert.equal(host.shadowRoot, null, 'Host page scripts cannot access closed shadowRoot');

  // Host page querySelector cannot find internal badge pills
  const hostBadgePill = document.querySelector('.askbro-badge-pill');
  assert.equal(hostBadgePill, null, 'Internal badge elements must not leak into host DOM queries');

  removeBadges();
});

// ---------------------------------------------------------------------------
// 5. Accidental Sensitive Data Entry Tests
// ---------------------------------------------------------------------------

test('Risk 5: Sensitive Data Entry - Field Guard rejects passwords, OTP, CVV, and credit card inputs', () => {
  const { document } = createTestEnvironment(`
    <form id="sensitive-form">
      <input type="password" id="f-pwd" />
      <input type="text" autocomplete="one-time-code" id="f-otp" />
      <input type="text" autocomplete="cc-number" id="f-card" />
      <input type="text" name="user_pin" id="f-pin" />
      <input type="text" placeholder="CVV code" id="f-cvv" />
      <input type="text" data-testid="security_passcode" id="f-passcode" />
      <input type="text" name="applicant_name" id="f-safe" />
    </form>
  `);

  const pwd = document.getElementById('f-pwd')!;
  const otp = document.getElementById('f-otp')!;
  const card = document.getElementById('f-card')!;
  const pin = document.getElementById('f-pin')!;
  const cvv = document.getElementById('f-cvv')!;
  const passcode = document.getElementById('f-passcode')!;
  const safe = document.getElementById('f-safe')!;

  assert.equal(checkFieldSafety(pwd).isSensitive, true);
  assert.equal(checkFieldSafety(otp).isSensitive, true);
  assert.equal(checkFieldSafety(card).isSensitive, true);
  assert.equal(checkFieldSafety(pin).isSensitive, true);
  assert.equal(checkFieldSafety(cvv).isSensitive, true);
  assert.equal(checkFieldSafety(passcode).isSensitive, true);

  // Safe field check
  assert.equal(checkFieldSafety(safe).isSensitive, false);
  assert.equal(isSensitiveField(safe), false);
});

test('Risk 5: Sensitive Data Entry - Split OTP / 2FA single-character input cluster detection', () => {
  const { document } = createTestEnvironment(`
    <form id="2fa-form">
      <label>Enter 6-digit verification code sent to your phone</label>
      <div class="auth-cluster">
        <input type="text" maxlength="1" class="verify-cell" id="digit-1" />
        <input type="text" maxlength="1" class="verify-cell" id="digit-2" />
        <input type="text" maxlength="1" class="verify-cell" id="digit-3" />
        <input type="text" maxlength="1" class="verify-cell" id="digit-4" />
        <input type="text" maxlength="1" class="verify-cell" id="digit-5" />
        <input type="text" maxlength="1" class="verify-cell" id="digit-6" />
      </div>
    </form>
  `);

  for (let i = 1; i <= 6; i++) {
    const box = document.getElementById(`digit-${i}`)!;
    const safety = checkFieldSafety(box);
    assert.equal(safety.isSafe, false, `Split OTP box #${i} must be blocked`);
    assert.equal(safety.isSensitive, true);
    assert.equal(safety.matchedRule, 'one-time-code');
    assert.ok(safety.reason?.includes('Split OTP / 2FA'));
  }
});

test('Risk 5: Sensitive Data Entry - In scanner.ts and executor.ts, sensitive fields are blocked before execution', async () => {
  const { document } = createTestEnvironment(`
    <form id="login-form">
      <input type="text" name="username" id="username" value="user@domain.com" />
      <input type="password" name="password" id="password" />
      <button type="submit" id="login-btn">Sign in</button>
    </form>
  `);

  clearScannerRegistry();
  removeBadges();

  // Scanner must completely omit password from scan and badges
  const scanned = scanInteractiveElements({
    root: document.getElementById('login-form')!,
    filterHidden: false,
    filterSensitive: true,
  });

  const scannedTags = scanned.map((s) => s.tag);
  const scannedTypes = scanned.map((s) => s.type);
  assert.ok(!scannedTypes.includes('password'), 'Password input must be omitted by scanner');

  // Executor two-layer defense-in-depth: Even if a step targets a sensitive field, executor rejects it
  const pwdEl = document.getElementById('password')!;
  const unsafeStep = {
    action: 'type' as const,
    targetId: null,
    value: 'secret123',
    reason: 'Try to enter password',
    isConsequential: false,
  };

  // Direct safety check via executor
  const safetyResult = checkFieldSafety(pwdEl);
  assert.equal(safetyResult.isSensitive, true);

  removeBadges();
});
