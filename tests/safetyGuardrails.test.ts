import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';

// Domain Guard
import {
  RESTRICTED_DOMAINS,
  isRestrictedDomain,
  isBlockedDomain,
  checkDomainSafety,
  getRestrictedDomainReason,
} from '../src/services/safety/domainGuard';

// Field Guard
import {
  SENSITIVE_FIELD_REGEX,
  checkFieldSafety,
  isSensitiveField,
} from '../src/services/safety/fieldGuard';

// Consequential Guard
import {
  CONSEQUENTIAL_TARGET_KEYWORDS,
  checkConsequentialTarget,
  isActionConsequential,
  isConsequentialTargetText,
} from '../src/services/safety/consequentialGuard';

// Integration with Scanner & Executor
import {
  scanInteractiveElements,
  clearScannerRegistry,
  getElementById,
} from '../src/content/scanner';
import { executeAction } from '../src/content/executor';
import type { ActionStep, ActionableElement } from '../src/types/action';

// UI Components
import ConsequentialConfirmationModal from '../src/sidepanel/components/Agent/ConsequentialConfirmationModal';
import ActionCard from '../src/sidepanel/components/Agent/ActionCard';
import AgentView from '../src/sidepanel/components/Agent/AgentView';

/**
 * Helper to create a JSDOM document with simulated window environment
 */
function createTestEnvironment(html: string, url = 'https://askbro.test/page') {
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  // Mock layout sizes for all elements
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      top: 50,
      left: 50,
      bottom: 80,
      right: 250,
      width: 200,
      height: 30,
      x: 50,
      y: 50,
      toJSON: () => {},
    };
  };

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

  return { dom, window, document };
}

// ===========================================================================
// Section 1: Domain Guardrails (Slice 4.3)
// ===========================================================================

test('Slice 4.3 - Domain Guard: RESTRICTED_DOMAINS contains all required keywords', () => {
  const required = [
    'bank',
    'paytm',
    'phonepe',
    'razorpay',
    'upi',
    'checkout',
    'billing',
    'stripe',
  ];

  for (const keyword of required) {
    assert.ok(
      RESTRICTED_DOMAINS.includes(keyword),
      `RESTRICTED_DOMAINS must include "${keyword}"`
    );
  }
});

test('Slice 4.3 - Domain Guard: Blocks banking and financial websites', () => {
  const bankingUrls = [
    'https://www.hdfcbank.com/personal',
    'https://netbanking.icicibank.com/login',
    'https://www.bankofamerica.com',
    'https://usbank.com/online-banking',
    'https://chase.com/bank/login',
    'https://axisbank.com/portal',
    'https://secure.mybank.org',
  ];

  for (const url of bankingUrls) {
    const check = checkDomainSafety(url);
    assert.equal(check.isBlocked, true, `URL ${url} should be blocked`);
    assert.equal(check.isSafe, false);
    assert.equal(isRestrictedDomain(url), true);
    assert.equal(isBlockedDomain(url), true);
    assert.ok(check.reason && check.reason.length > 10);
  }
});

test('Slice 4.3 - Domain Guard: Blocks payment gateways, UPI, and checkout endpoints', () => {
  const paymentUrls = [
    'https://paytm.com/recharge',
    'https://www.phonepe.com/merchant-portal',
    'https://razorpay.com/payment-gateway',
    'https://upi.npci.org.in/pay',
    'https://checkout.stripe.com/c/pay/cs_test',
    'https://store.example.com/checkout/step1',
    'https://portal.example.com/billing/invoice',
    'https://paypal.com/signin',
  ];

  for (const url of paymentUrls) {
    const check = checkDomainSafety(url);
    assert.equal(check.isBlocked, true, `Payment URL ${url} should be blocked`);
    assert.equal(check.isSafe, false);
    assert.ok(check.matchedKeyword, `Must provide matched keyword for ${url}`);
  }
});

test('Slice 4.3 - Domain Guard: Allows safe educational, search, and reading domains', () => {
  const safeUrls = [
    'https://news.ycombinator.com',
    'https://en.wikipedia.org/wiki/Artificial_intelligence',
    'https://github.com/facebook/react',
    'https://medium.com/@author/learning-agentic-coding',
    'https://developer.chrome.com/docs/extensions/mv3',
    'https://stackoverflow.com/questions/12345',
  ];

  for (const url of safeUrls) {
    const check = checkDomainSafety(url);
    assert.equal(check.isBlocked, false, `Safe URL ${url} should NOT be blocked`);
    assert.equal(check.isSafe, true);
    assert.equal(isRestrictedDomain(url), false);
  }
});

test('Slice 4.3 - Domain Guard: Handles empty, null, and malformed URLs gracefully', () => {
  assert.equal(checkDomainSafety('').isBlocked, false);
  assert.equal(checkDomainSafety(null).isBlocked, false);
  assert.equal(checkDomainSafety(undefined).isBlocked, false);

  // Malformed but contains restricted word
  assert.equal(checkDomainSafety('not-a-valid-url-bank-login').isBlocked, true);
  // Malformed safe
  assert.equal(checkDomainSafety('regular-unparsable-text').isBlocked, false);
});

test('Slice 4.3 - Domain Guard: Generates user-friendly descriptive reasons', () => {
  const bankReason = getRestrictedDomainReason('bank');
  assert.ok(bankReason.includes('Banking domain detected'));

  const paytmReason = getRestrictedDomainReason('paytm');
  assert.ok(paytmReason.includes('Payment gateway detected'));

  const checkoutReason = getRestrictedDomainReason('checkout');
  assert.ok(checkoutReason.includes('Checkout / Billing page detected'));
});

// ===========================================================================
// Section 2: Field Guardrails (Slice 4.3)
// ===========================================================================

test('Slice 4.3 - Field Guard: Rejects input[type="password"] deterministically', () => {
  const { document } = createTestEnvironment(`
    <form>
      <input type="password" id="user-pass" name="pwd" />
    </form>
  `);

  const passEl = document.getElementById('user-pass') as HTMLInputElement;
  const safety = checkFieldSafety(passEl);

  assert.equal(safety.isSafe, false);
  assert.equal(safety.isSensitive, true);
  assert.equal(safety.matchedRule, 'password');
  assert.equal(isSensitiveField(passEl), true);

  // Metadata object check
  const meta: ActionableElement = {
    id: 1,
    tag: 'input',
    type: 'password',
    name: 'pwd',
    rect: { top: 0, left: 0, width: 100, height: 20 },
  };
  assert.equal(isSensitiveField(meta), true);
});

test('Slice 4.3 - Field Guard: Rejects input[autocomplete*="one-time-code"]', () => {
  const { document } = createTestEnvironment(`
    <form>
      <input type="text" autocomplete="one-time-code" id="two-fa-input" />
    </form>
  `);

  const otpEl = document.getElementById('two-fa-input') as HTMLInputElement;
  const safety = checkFieldSafety(otpEl);

  assert.equal(safety.isSafe, false);
  assert.equal(safety.isSensitive, true);
  assert.equal(safety.matchedRule, 'one-time-code');
  assert.equal(isSensitiveField(otpEl), true);
});

test('Slice 4.3 - Field Guard: Rejects credit card autofill inputs input[autocomplete*="cc-"]', () => {
  const { document } = createTestEnvironment(`
    <form>
      <input type="text" autocomplete="cc-number" id="card-num" />
      <input type="text" autocomplete="cc-csc" id="card-sec" />
      <input type="text" autocomplete="cc-exp" id="card-expiry" />
    </form>
  `);

  const numEl = document.getElementById('card-num')!;
  const cscEl = document.getElementById('card-sec')!;
  const expEl = document.getElementById('card-expiry')!;

  assert.equal(checkFieldSafety(numEl).matchedRule, 'credit-card');
  assert.equal(checkFieldSafety(cscEl).matchedRule, 'credit-card');
  assert.equal(checkFieldSafety(expEl).matchedRule, 'credit-card');
});

test('Slice 4.3 - Field Guard: Rejects RegEx matching /(otp|cvv|pin|card|ssn)/i on name, id, or placeholder', () => {
  const { document } = createTestEnvironment(`
    <form>
      <input type="text" name="user_otp" id="inp1" />
      <input type="text" name="securityCode" id="card-cvv-code" />
      <input type="text" name="enter_pin" id="inp3" />
      <input type="text" name="cardholder_number" id="inp4" />
      <input type="text" name="tax_ssn" id="inp5" />
      <input type="text" placeholder="Enter 6-digit OTP" id="inp6" />
      <input type="text" placeholder="CVV code on back of card" id="inp7" />
      <input type="text" placeholder="Enter ATM PIN" id="inp8" />
      <input type="text" placeholder="Social Security Number (SSN)" id="inp9" />
    </form>
  `);

  for (let i = 1; i <= 9; i++) {
    const el = document.getElementById(`inp${i}`) || document.getElementById('card-cvv-code');
    assert.ok(el, `Element #${i} must exist`);
    const safety = checkFieldSafety(el);
    assert.equal(safety.isSafe, false, `Field #${i} (${el?.getAttribute('name') || el?.getAttribute('placeholder')}) should be rejected`);
    assert.equal(safety.isSensitive, true);
    assert.equal(safety.matchedRule, 'sensitive-regex');
  }
});

test('Slice 4.3 - Field Guard: Allows non-sensitive user profile and search inputs', () => {
  const { document } = createTestEnvironment(`
    <form>
      <input type="text" name="fullName" placeholder="Your Full Name" id="name" />
      <input type="email" name="email" placeholder="you@example.com" id="email" />
      <input type="text" name="college" placeholder="IIT Bombay" id="college" />
      <input type="search" name="q" placeholder="Search articles..." id="search" />
      <textarea name="coverLetter" placeholder="Write your cover note..." id="note"></textarea>
      <select name="major" id="major"><option>Computer Science</option></select>
    </form>
  `);

  const allowedIds = ['name', 'email', 'college', 'search', 'note', 'major'];
  for (const id of allowedIds) {
    const el = document.getElementById(id)!;
    const safety = checkFieldSafety(el);
    assert.equal(safety.isSafe, true, `Field ${id} should be safe`);
    assert.equal(safety.isSensitive, false);
    assert.equal(isSensitiveField(el), false);
  }
});

test('Slice 4.3 - Field Guard: In scanner.ts, filters sensitive fields from interactive scan', () => {
  const { document } = createTestEnvironment(`
    <form id="auth-form">
      <input type="text" name="username" placeholder="Enter username" id="username" />
      <input type="password" name="password" placeholder="Password" id="password" />
      <input type="text" name="otp" placeholder="Enter OTP" id="otp" />
      <input type="text" name="cardNumber" placeholder="Card #" id="card" />
      <button type="submit" id="submit-btn">Login</button>
    </form>
  `);

  clearScannerRegistry();
  const scanned = scanInteractiveElements({ root: document.getElementById('auth-form')!, filterHidden: false });

  // Only username and submit-btn should be scanned. Password, OTP, and Card must be omitted!
  assert.equal(scanned.length, 2, 'Must omit the 3 sensitive fields (password, otp, card)');
  assert.equal(scanned[0].name, 'username');
  assert.equal(scanned[1].tag, 'button');

  // Verify registry does not contain password or OTP elements
  assert.equal(getElementById(1)?.id, 'username');
  assert.equal(getElementById(2)?.id, 'submit-btn');
});

test('Slice 4.3 - Field Guard: In executor.ts, explicitly rejects interaction with sensitive fields', async () => {
  const { document } = createTestEnvironment(`
    <form id="payment-form">
      <input type="password" id="secret-pass" value="" />
      <input type="text" name="user_otp" id="otp-field" value="" />
    </form>
  `);

  clearScannerRegistry();
  // Manually register sensitive fields to test executor defense-in-depth
  const passEl = document.getElementById('secret-pass')!;
  const otpEl = document.getElementById('otp-field')!;

  // Force register for testing executor barrier
  const scanned = scanInteractiveElements({
    root: document.getElementById('payment-form')!,
    filterHidden: false,
    filterSensitive: false, // Bypass scanner to test executor check!
  });

  assert.equal(scanned.length, 2);

  // 1. Attempt typing into password field
  const passStep: ActionStep = {
    action: 'type',
    targetId: 1,
    value: 'SuperSecret123',
    reason: 'Attempt password entry',
    isConsequential: false,
  };

  const passRes = await executeAction(passStep);
  assert.equal(passRes.success, false, 'Executor must block typing into password');
  assert.equal(passRes.executed, false);
  assert.ok(passRes.error?.includes('Blocked by Field Guard'));

  // 2. Attempt typing into OTP field
  const otpStep: ActionStep = {
    action: 'type',
    targetId: 2,
    value: '123456',
    reason: 'Attempt OTP entry',
    isConsequential: false,
  };

  const otpRes = await executeAction(otpStep);
  assert.equal(otpRes.success, false, 'Executor must block typing into OTP');
  assert.equal(otpRes.executed, false);
  assert.ok(otpRes.error?.includes('Blocked by Field Guard'));

  // 3. Attempt clicking sensitive field
  const clickStep: ActionStep = {
    action: 'click',
    targetId: 1,
    value: null,
    reason: 'Attempt click on password',
    isConsequential: false,
  };
  const clickRes = await executeAction(clickStep);
  assert.equal(clickRes.success, false);
  assert.ok(clickRes.error?.includes('Blocked by Field Guard'));
});

// ===========================================================================
// Section 3: Consequential Action Warning & Secondary Modal (Slice 4.3)
// ===========================================================================

test('Slice 4.3 - Consequential Guard: CONSEQUENTIAL_TARGET_KEYWORDS contains required keywords', () => {
  const required = ['submit', 'place order', 'pay', 'delete'];
  for (const keyword of required) {
    assert.ok(
      CONSEQUENTIAL_TARGET_KEYWORDS.includes(keyword as any),
      `CONSEQUENTIAL_TARGET_KEYWORDS must include "${keyword}"`
    );
  }
});

test('Slice 4.3 - Consequential Guard: Detects consequential button texts', () => {
  const consequentialTexts = [
    'Submit Application',
    'Submit Form',
    'Place Order',
    'Place Order Now',
    'Pay Now',
    'Pay $49.00',
    'Delete Account',
    'Delete Record',
    'Confirm & Pay',
    'Complete Purchase',
  ];

  for (const text of consequentialTexts) {
    const check = checkConsequentialTarget(text);
    assert.equal(check.isConsequential, true, `Text "${text}" should be consequential`);
    assert.ok(check.matchedKeyword);
    assert.equal(isConsequentialTargetText(text), true);
  }
});

test('Slice 4.3 - Consequential Guard: Allows non-consequential navigation and input buttons', () => {
  const safeTexts = [
    'Next Step',
    'Previous',
    'Continue Reading',
    'Search Products',
    'Filter Categories',
    'Preview Draft',
    'Upload Resume',
    'Learn More',
  ];

  for (const text of safeTexts) {
    const check = checkConsequentialTarget(text);
    assert.equal(check.isConsequential, false, `Text "${text}" should NOT be consequential`);
    assert.equal(isConsequentialTargetText(text), false);
  }
});

test('Slice 4.3 - Consequential Guard: isActionConsequential identifies consequential ActionSteps', () => {
  // 1. Flagged consequential by model
  const flaggedStep: ActionStep = {
    action: 'click',
    targetId: 5,
    value: null,
    reason: 'Submit data',
    isConsequential: true,
  };
  assert.equal(isActionConsequential(flaggedStep), true);

  // 2. Unflagged by model but target element has "Submit Application"
  const unflaggedStep: ActionStep = {
    action: 'click',
    targetId: 3,
    value: null,
    reason: 'Click the button',
    isConsequential: false,
  };
  const targetElement: ActionableElement = {
    id: 3,
    tag: 'button',
    text: 'Submit Application',
    rect: { top: 0, left: 0, width: 100, height: 30 },
  };
  assert.equal(isActionConsequential(unflaggedStep, targetElement), true);

  // 3. Reason states "Pay with card"
  const payStep: ActionStep = {
    action: 'click',
    targetId: 2,
    value: null,
    reason: 'Pay with saved credit card',
    isConsequential: false,
  };
  assert.equal(isActionConsequential(payStep), true);

  // 4. Safe action
  const safeStep: ActionStep = {
    action: 'click',
    targetId: 1,
    value: null,
    reason: 'Navigate to next page',
    isConsequential: false,
  };
  const safeElement: ActionableElement = {
    id: 1,
    tag: 'button',
    text: 'Next Page',
    rect: { top: 0, left: 0, width: 100, height: 30 },
  };
  assert.equal(isActionConsequential(safeStep, safeElement), false);
});

test('Slice 4.3 - ConsequentialConfirmationModal renders amber warning with explicit toggle', () => {
  const step: ActionStep = {
    action: 'click',
    targetId: 4,
    value: null,
    reason: 'Submit the final job application',
    isConsequential: true,
  };

  const element: ActionableElement = {
    id: 4,
    tag: 'button',
    text: 'Submit Application',
    rect: { top: 0, left: 0, width: 100, height: 30 },
  };

  const html = renderToString(
    React.createElement(ConsequentialConfirmationModal, {
      isOpen: true,
      step,
      element,
      matchedKeyword: 'submit',
      onConfirm: () => {},
      onCancel: () => {},
    })
  );

  assert.ok(html.includes('High-Consequence Action'));
  assert.ok(html.includes('SUBMIT'));
  assert.ok(html.includes('Submit Application'));
  assert.ok(html.includes('I understand this action is consequential'));
  assert.ok(html.includes('askbro-consequential-toggle'));
  assert.ok(html.includes('askbro-consequential-confirm-btn'));
  assert.ok(html.includes('Confirm &amp; Execute') || html.includes('Confirm & Execute'));
});

test('Slice 4.3 - ActionCard integrates Consequential Guard and requires secondary confirmation', () => {
  const consequentialStep: ActionStep = {
    action: 'click',
    targetId: 7,
    value: null,
    reason: 'Finalize order and submit payment',
    isConsequential: true,
  };

  const targetElement: ActionableElement = {
    id: 7,
    tag: 'button',
    text: 'Place Order',
    rect: { top: 0, left: 0, width: 100, height: 30 },
  };

  const html = renderToString(
    React.createElement(ActionCard, {
      step: consequentialStep,
      element: targetElement,
      onApprove: () => {},
      onStop: () => {},
      showControls: true,
    })
  );

  // Must render consequential alert banner
  assert.ok(html.includes('High-Impact / Consequential Step'));
  assert.ok(html.includes('PLACE ORDER'));
  assert.ok(html.includes('Approve Consequential Step'));
});

// ===========================================================================
// Section 4: Domain Guard Integration in AgentView (Slice 4.3)
// ===========================================================================

test('Slice 4.3 - AgentView: Renders protective badge and disables agent loop on restricted banking domain', () => {
  createTestEnvironment('<div>Mock Page</div>', 'https://netbanking.hdfcbank.com/login');

  const html = renderToString(
    React.createElement(AgentView, {
      settings: {
        geminiApiKey: 'AIzaSyMockKeyForSafetyTest1234567890',
        groqApiKey: '',
        model: 'gemini-1.5-flash-lite',
        language: 'en',
      },
    })
  );

  // Verify protective banner or badge is rendered
  assert.ok(html.includes('Protected Domain') || html.includes('HITL Controlled'));
  assert.ok(html.includes('Browser Agent'));
});

test('Slice 4.3 Acceptance Criteria - Safety rails actively block banking sites, password fields, and OTP inputs without relying on LLM compliance', async () => {
  // 1. Banking domain hard block:
  const isBankBlocked = isRestrictedDomain('https://chase.com/bank/login');
  assert.equal(isBankBlocked, true, 'Banking site must be blocked by code safety rails without LLM compliance');

  const isUpiBlocked = isRestrictedDomain('https://paytm.com/checkout');
  assert.equal(isUpiBlocked, true, 'Payment/checkout site must be blocked without LLM compliance');

  // 2. Password field hard block:
  const { document } = createTestEnvironment(`
    <input type="password" id="pwd" />
    <input type="text" autocomplete="one-time-code" id="otp" />
  `);

  const passEl = document.getElementById('pwd')!;
  const otpEl = document.getElementById('otp')!;

  assert.equal(isSensitiveField(passEl), true, 'Password field must be hard blocked');
  assert.equal(isSensitiveField(otpEl), true, 'OTP field must be hard blocked');

  // 3. Executor verification:
  clearScannerRegistry();
  scanInteractiveElements({ root: document.body, filterHidden: false, filterSensitive: false });

  const passExecution = await executeAction({
    action: 'type',
    targetId: 1,
    value: 'secret',
    reason: 'LLM proposed typing into password',
    isConsequential: false,
  });
  assert.equal(passExecution.success, false, 'Executor must deterministically reject password input');

  const otpExecution = await executeAction({
    action: 'type',
    targetId: 2,
    value: '999888',
    reason: 'LLM proposed typing OTP',
    isConsequential: false,
  });
  assert.equal(otpExecution.success, false, 'Executor must deterministically reject OTP input');
});

test('Slice 4.3 Acceptance Criteria - Consequential buttons ("Pay", "Submit") trigger the secondary confirmation warning', () => {
  const payButtonCheck = checkConsequentialTarget('Pay $199.00');
  assert.equal(payButtonCheck.isConsequential, true, '"Pay" button must trigger consequential warning');
  assert.equal(payButtonCheck.matchedKeyword, 'pay');

  const submitButtonCheck = checkConsequentialTarget('Submit Application');
  assert.equal(submitButtonCheck.isConsequential, true, '"Submit" button must trigger consequential warning');
  assert.equal(submitButtonCheck.matchedKeyword, 'submit');

  const placeOrderCheck = checkConsequentialTarget('Place Order');
  assert.equal(placeOrderCheck.isConsequential, true, '"Place Order" must trigger consequential warning');
  assert.equal(placeOrderCheck.matchedKeyword, 'place order');

  const deleteCheck = checkConsequentialTarget('Delete Database');
  assert.equal(deleteCheck.isConsequential, true, '"Delete" must trigger consequential warning');
  assert.equal(deleteCheck.matchedKeyword, 'delete');
});

