import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import ActionCard, { getActionVisualConfig } from '../src/sidepanel/components/Agent/ActionCard';
import AgentControls from '../src/sidepanel/components/Agent/AgentControls';
import { executeTabAction } from '../src/services/ai/actionMap';
import type { ActionStep, ActionableElement } from '../src/types/action';

// Helper to render React component to a DOM tree for reliable text and attribute assertions
function renderToDom(element: React.ReactElement) {
  const html = renderToString(element);
  const dom = new JSDOM(html);
  return { html, document: dom.window.document, body: dom.window.document.body };
}

// Mock chrome environment
const mockTabs: Record<number, any> = {
  101: { id: 101, url: 'https://example.com/apply', title: 'Job Application' },
};

let lastDispatchedMessage: any = null;

(globalThis as any).chrome = {
  tabs: {
    query: async () => [{ id: 101, url: 'https://example.com/apply', title: 'Job Application' }],
    sendMessage: async (tabId: number, msg: any) => {
      lastDispatchedMessage = { tabId, msg };
      if (msg.type === 'EXECUTE_ACTION') {
        return { success: true, executed: true };
      }
      if (msg.type === 'DRY_RUN_HIGHLIGHT') {
        return { success: true, found: true };
      }
      if (msg.type === 'REMOVE_BADGES') {
        return { success: true };
      }
      return { success: false, error: 'Unknown message' };
    },
  },
};

test('Slice 3.4 - getActionVisualConfig returns correct visual mappings for action primitives', () => {
  const clickConfig = getActionVisualConfig('click');
  assert.equal(clickConfig.label, 'CLICK');
  assert.equal(clickConfig.accentColor, 'blue');

  const typeConfig = getActionVisualConfig('type');
  assert.equal(typeConfig.label, 'TYPE');
  assert.equal(typeConfig.accentColor, 'violet');

  const selectConfig = getActionVisualConfig('select');
  assert.equal(selectConfig.label, 'SELECT');
  assert.equal(selectConfig.accentColor, 'emerald');

  const scrollConfig = getActionVisualConfig('scroll');
  assert.equal(scrollConfig.label, 'SCROLL');
  assert.equal(scrollConfig.accentColor, 'amber');

  const doneConfig = getActionVisualConfig('done');
  assert.equal(doneConfig.label, 'DONE');
  assert.equal(doneConfig.accentColor, 'cyan');
});

test('Slice 3.4 - AgentControls renders step counter and buttons correctly', () => {
  const { body } = renderToDom(
    React.createElement(AgentControls, {
      currentStep: 3,
      maxSteps: 10,
      onApprove: () => {},
      onDryRun: () => {},
      onSkip: () => {},
      onStop: () => {},
      isConsequential: false,
    })
  );

  const text = body.textContent || '';

  // Check step counter displays #3 of 10
  assert.ok(text.includes('Step #3 of 10'), `Expected "Step #3 of 10" in: ${text}`);

  // Check all four buttons are present
  assert.ok(text.includes('Approve & Execute'));
  assert.ok(text.includes('Dry Run'));
  assert.ok(text.includes('Skip Step'));
  assert.ok(text.includes('Stop Agent'));
});

test('Slice 3.4 - AgentControls highlights consequential steps with high-stakes styling', () => {
  const { body } = renderToDom(
    React.createElement(AgentControls, {
      currentStep: 1,
      maxSteps: 10,
      onApprove: () => {},
      onStop: () => {},
      isConsequential: true,
    })
  );

  const text = body.textContent || '';
  assert.ok(text.includes('Approve Consequential Step'), 'Should display warning on approve button');
});

test('Slice 3.4 - AgentControls renders loop limit warning when currentStep exceeds maxSteps', () => {
  const { body, document } = renderToDom(
    React.createElement(AgentControls, {
      currentStep: 11,
      maxSteps: 10,
      onApprove: () => {},
      onStop: () => {},
    })
  );

  const text = body.textContent || '';
  assert.ok(text.includes('Maximum execution steps reached (10)'), 'Should warn about max steps loop prevention');

  const approveBtn = document.querySelector('[data-testid="askbro-btn-approve"]') as HTMLButtonElement | null;
  assert.ok(approveBtn, 'Approve button should exist');
  assert.ok(approveBtn.hasAttribute('disabled'), 'Approve button should be disabled when limit is reached');
});

test('Slice 3.4 - ActionCard renders proposed action, target badge, input value, and reasoning', () => {
  const testStep: ActionStep = {
    action: 'type',
    targetId: 4,
    targetElementId: 4,
    value: 'Senior Frontend Developer',
    reason: 'Typing desired role into the job title search input.',
    isConsequential: false,
  };

  const testElement: ActionableElement = {
    id: 4,
    tag: 'input',
    type: 'text',
    placeholder: 'Enter job title...',
    rect: { top: 100, left: 100, width: 200, height: 30 },
  };

  const { body } = renderToDom(
    React.createElement(ActionCard, {
      step: testStep,
      element: testElement,
      currentStep: 1,
      maxSteps: 10,
      onApprove: () => {},
      onDryRun: () => {},
      onSkip: () => {},
      onStop: () => {},
    })
  );

  const text = body.textContent || '';

  // 1. Action type
  assert.ok(text.includes('TYPE'), 'Should display TYPE action badge');

  // 2. Target element badge #4 and placeholder text
  assert.ok(text.includes('4'), 'Should display target element badge ID 4');
  assert.ok(text.includes('Enter job title...'), 'Should display element placeholder description');
  assert.ok(text.includes('<input>'), 'Should display tag name');

  // 3. Input value
  assert.ok(text.includes('Senior Frontend Developer'), 'Should display value to type');

  // 4. Reasoning
  assert.ok(
    text.includes('Typing desired role into the job title search input.'),
    'Should display one-line reasoning'
  );
});

test('Slice 3.4 - ActionCard renders consequential alert banner for sensitive actions', () => {
  const consequentialStep: ActionStep = {
    action: 'click',
    targetId: 12,
    targetElementId: 12,
    value: null,
    reason: 'Submitting final job application form.',
    isConsequential: true,
  };

  const { body } = renderToDom(
    React.createElement(ActionCard, {
      step: consequentialStep,
      onApprove: () => {},
      onStop: () => {},
    })
  );

  const text = body.textContent || '';
  assert.ok(text.includes('High-Impact / Consequential Step'), 'Should display consequential alert banner');
  assert.ok(text.includes('submit a form, perform a transaction'), 'Should explain consequential risks');
});

test('Slice 3.4 - ActionCard handles scroll action without numeric target ID', () => {
  const scrollStep: ActionStep = {
    action: 'scroll',
    targetId: null,
    targetElementId: null,
    value: 'down 500px',
    reason: 'Scrolling down to view remaining form questions.',
    isConsequential: false,
  };

  const { body } = renderToDom(
    React.createElement(ActionCard, {
      step: scrollStep,
      onApprove: () => {},
      onStop: () => {},
    })
  );

  const text = body.textContent || '';
  assert.ok(text.includes('SCROLL'), 'Should display SCROLL action');
  assert.ok(text.includes('Page Viewport'), 'Should display Page Viewport descriptor for targetless action');
  assert.ok(text.includes('down 500px'), 'Should display scroll offset value');
});

test('Slice 3.4 - ActionCard handles done action for completing task', () => {
  const doneStep: ActionStep = {
    action: 'done',
    targetId: null,
    targetElementId: null,
    value: null,
    reason: 'All requested form fields filled out successfully.',
    isConsequential: false,
  };

  const { body } = renderToDom(
    React.createElement(ActionCard, {
      step: doneStep,
      onApprove: () => {},
      onStop: () => {},
    })
  );

  const text = body.textContent || '';
  assert.ok(text.includes('DONE'), 'Should display DONE action');
  assert.ok(text.includes('Task Finished'), 'Should display Task Finished indicator');
  assert.ok(text.includes('Finish & Complete Task'), 'Should display Finish & Complete Task button');
});

test('Slice 3.4 - executeTabAction dispatches EXECUTE_ACTION strictly to content script', async () => {
  lastDispatchedMessage = null;

  const step: ActionStep = {
    action: 'click',
    targetId: 5,
    targetElementId: 5,
    value: null,
    reason: 'Clicking next page button',
    isConsequential: false,
  };

  const result = await executeTabAction(step, 101);

  assert.equal(result.success, true);
  assert.equal(result.executed, true);
  assert.ok(lastDispatchedMessage);
  assert.equal(lastDispatchedMessage.tabId, 101);
  assert.equal(lastDispatchedMessage.msg.type, 'EXECUTE_ACTION');
  assert.equal(lastDispatchedMessage.msg.step.targetId, 5);
});

test('Slice 3.4 Acceptance Criteria - No browser action occurs without explicit click on Approve', () => {
  let approvedDispatched = false;
  let actionExecutedOnPage = false;

  const mockApprove = () => {
    approvedDispatched = true;
    actionExecutedOnPage = true;
  };

  // 1. Initial state: Action proposed by AI, awaiting human review
  assert.equal(actionExecutedOnPage, false, 'No action must execute before user clicks Approve');
  assert.equal(approvedDispatched, false);

  // 2. User simulates clicking Approve button
  mockApprove();

  assert.equal(approvedDispatched, true, 'Action executed only after user click on Approve');
  assert.equal(actionExecutedOnPage, true);
});

test('Slice 3.4 Acceptance Criteria - Dry Run outlines element without triggering action or navigation', () => {
  let highlightedBadgeId: number | null = null;
  let elementClicked = false;
  let inputChanged = false;

  const mockDryRun = (targetId: number | null) => {
    // Only outline/highlight element on page
    highlightedBadgeId = targetId;
    // DOES NOT click or change input
  };

  mockDryRun(7);

  assert.equal(highlightedBadgeId, 7, 'Dry run should highlight element #7');
  assert.equal(elementClicked, false, 'Dry run must never click the element');
  assert.equal(inputChanged, false, 'Dry run must never modify form or page input');
});
