import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  executeAction,
  simulateClick,
  simulateType,
  simulateSelect,
  simulateScroll,
  resolveTargetElement,
  registerExecutorListener,
  unregisterExecutorListener,
  DEFAULT_SCROLL_OFFSET,
} from '../src/content/executor';
import { scanInteractiveElements, clearScannerRegistry } from '../src/content/scanner';
import { removeBadges } from '../src/content/badges';
import type { ActionStep } from '../src/types/action';

/**
 * Helper to create a JSDOM document with simulated window and globals
 */
function createTestEnvironment(html: string) {
  const dom = new JSDOM(html, {
    url: 'https://askbro.test/page',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  // Mock layout sizes for all elements in test environment
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

  // Set up globals
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

  // Mock scroll methods if not defined
  if (!window.scrollBy) {
    (window as any).scrollBy = () => {};
  }
  if (!window.scrollTo) {
    (window as any).scrollTo = () => {};
  }

  return { dom, window, document };
}

test('Slice 3.5 - simulateClick focuses element and dispatches pointerdown, mousedown, pointerup, mouseup, click in sequence', () => {
  const { document } = createTestEnvironment(`
    <div>
      <button id="btn">Submit Order</button>
    </div>
  `);

  const btn = document.getElementById('btn') as HTMLButtonElement;
  let focusCalled = false;
  btn.focus = () => {
    focusCalled = true;
  };

  const firedEvents: Array<{ type: string; bubbles: boolean; cancelable: boolean; button?: number }> = [];

  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtType) => {
    btn.addEventListener(evtType, (e: any) => {
      firedEvents.push({
        type: e.type,
        bubbles: e.bubbles,
        cancelable: e.cancelable,
        button: e.button,
      });
    });
  });

  const result = simulateClick(btn);

  assert.equal(result, true);
  assert.equal(focusCalled, true, 'simulateClick must focus the target element');
  assert.equal(firedEvents.length, 5, 'Must dispatch all 5 pointer/mouse events');
  assert.deepEqual(
    firedEvents.map((e) => e.type),
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
    'Events must fire in strict order: pointerdown -> mousedown -> pointerup -> mouseup -> click'
  );
  assert.equal(firedEvents[0].bubbles, true);
  assert.equal(firedEvents[4].type, 'click');
});

test('Slice 3.5 - simulateClick toggles checkbox state and handles links', () => {
  const { document } = createTestEnvironment(`
    <div>
      <input type="checkbox" id="termsCheckbox" />
      <a href="https://example.com" id="navLink">Next Page</a>
      <div role="button" id="fakeBtn" tabindex="0">Custom Pill</div>
    </div>
  `);

  const cb = document.getElementById('termsCheckbox') as HTMLInputElement;
  const link = document.getElementById('navLink') as HTMLAnchorElement;
  const fakeBtn = document.getElementById('fakeBtn') as HTMLDivElement;

  let linkClickFired = false;
  link.addEventListener('click', () => {
    linkClickFired = true;
  });

  let fakeBtnClickFired = false;
  fakeBtn.addEventListener('click', () => {
    fakeBtnClickFired = true;
  });

  assert.equal(cb.checked, false);
  simulateClick(cb);
  assert.equal(cb.checked, true, 'Clicking checkbox must toggle checked state to true');

  simulateClick(link);
  assert.equal(linkClickFired, true, 'Clicking anchor must dispatch click');

  simulateClick(fakeBtn);
  assert.equal(fakeBtnClickFired, true, 'Clicking custom role="button" must dispatch click');
});

test('Slice 3.5 - simulateType clears input, sets .value, and dispatches input and change events', () => {
  const { document } = createTestEnvironment(`
    <div>
      <input type="text" id="username" value="initial_user" />
      <textarea id="bio">Old biography</textarea>
    </div>
  `);

  const input = document.getElementById('username') as HTMLInputElement;
  const textarea = document.getElementById('bio') as HTMLTextAreaElement;

  const inputEvents: string[] = [];
  input.addEventListener('input', () => inputEvents.push(`input:${input.value}`));
  input.addEventListener('change', () => inputEvents.push(`change:${input.value}`));

  let inputFocused = false;
  input.focus = () => {
    inputFocused = true;
  };

  const inputResult = simulateType(input, 'john_doe@example.com');

  assert.equal(inputResult, true);
  assert.equal(inputFocused, true, 'simulateType must focus element');
  assert.equal(input.value, 'john_doe@example.com');
  assert.equal(inputEvents.includes('input:john_doe@example.com'), true);
  assert.equal(inputEvents.includes('change:john_doe@example.com'), true);

  // Test Textarea
  const textareaEvents: string[] = [];
  textarea.addEventListener('input', () => textareaEvents.push(`input:${textarea.value}`));
  textarea.addEventListener('change', () => textareaEvents.push(`change:${textarea.value}`));

  const textareaResult = simulateType(textarea, 'New bio text here');
  assert.equal(textareaResult, true);
  assert.equal(textarea.value, 'New bio text here');
  assert.equal(textareaEvents.includes('input:New bio text here'), true);
  assert.equal(textareaEvents.includes('change:New bio text here'), true);
});

test('Slice 3.5 - simulateType works on contenteditable elements', () => {
  const { document } = createTestEnvironment(`
    <div id="editor" contenteditable="true">Initial document text</div>
  `);

  const editor = document.getElementById('editor') as HTMLDivElement;
  let inputFired = false;
  let changeFired = false;

  editor.addEventListener('input', () => {
    inputFired = true;
  });
  editor.addEventListener('change', () => {
    changeFired = true;
  });

  const result = simulateType(editor, 'Updated rich text content');
  assert.equal(result, true);
  assert.equal(editor.innerText, 'Updated rich text content');
  assert.equal(inputFired, true);
  assert.equal(changeFired, true);
});

test('Slice 3.5 - simulateType triggers React-controlled prototype value setter', () => {
  const { document, window } = createTestEnvironment(`
    <input type="text" id="reactInput" value="pre" />
  `);

  const input = document.getElementById('reactInput') as HTMLInputElement;
  let reactSetterIntercepted = false;

  // Simulate how React overrides the prototype descriptor
  const originalDescriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  const originalSet = originalDescriptor?.set;

  Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
    configurable: true,
    enumerable: true,
    get() {
      return originalDescriptor?.get?.call(this);
    },
    set(v: string) {
      reactSetterIntercepted = true;
      originalSet?.call(this, v);
    },
  });

  try {
    simulateType(input, 'react_value');
    assert.equal(reactSetterIntercepted, true, 'Native prototype setter should be invoked for React compatibility');
    assert.equal(input.value, 'react_value');
  } finally {
    // Restore descriptor
    if (originalDescriptor) {
      Object.defineProperty(window.HTMLInputElement.prototype, 'value', originalDescriptor);
    }
  }
});

test('Slice 3.5 - simulateSelect updates selectedIndex and dispatches change and input events', () => {
  const { document } = createTestEnvironment(`
    <select id="country">
      <option value="">Select country...</option>
      <option value="us">United States</option>
      <option value="in">India</option>
      <option value="de">Germany</option>
      <option value="jp">Japan</option>
    </select>
  `);

  const select = document.getElementById('country') as HTMLSelectElement;
  let changeFired = false;
  let inputFired = false;

  select.addEventListener('change', () => {
    changeFired = true;
  });
  select.addEventListener('input', () => {
    inputFired = true;
  });

  // 1. Select by exact value "in"
  const res1 = simulateSelect(select, 'in');
  assert.equal(res1, true);
  assert.equal(select.value, 'in');
  assert.equal(select.selectedIndex, 2);
  assert.equal(changeFired, true);
  assert.equal(inputFired, true);

  // 2. Select by text label "Germany"
  changeFired = false;
  const res2 = simulateSelect(select, 'Germany');
  assert.equal(res2, true);
  assert.equal(select.value, 'de');
  assert.equal(select.selectedIndex, 3);
  assert.equal(changeFired, true);

  // 3. Select by case-insensitive text "japan"
  const res3 = simulateSelect(select, 'japan');
  assert.equal(res3, true);
  assert.equal(select.value, 'jp');
  assert.equal(select.selectedIndex, 4);

  // 4. Select by numeric index string "1"
  const res4 = simulateSelect(select, '1');
  assert.equal(res4, true);
  assert.equal(select.value, 'us');
  assert.equal(select.selectedIndex, 1);

  // 5. Select non-existent option returns false
  const res5 = simulateSelect(select, 'non_existent_country');
  assert.equal(res5, false);
});

test('Slice 3.5 - simulateScroll scrolls target element into view', () => {
  const { document } = createTestEnvironment(`
    <div style="height: 2000px;">
      <button id="targetBtn" style="margin-top: 1500px;">Far Down Button</button>
    </div>
  `);

  const btn = document.getElementById('targetBtn') as HTMLButtonElement;
  let scrollIntoViewOptions: any = null;
  btn.scrollIntoView = (options?: any) => {
    scrollIntoViewOptions = options;
  };

  const result = simulateScroll(btn);
  assert.equal(result, true);
  assert.ok(scrollIntoViewOptions);
  assert.equal(scrollIntoViewOptions.behavior, 'smooth');
  assert.equal(scrollIntoViewOptions.block, 'center');
});

test('Slice 3.5 - simulateScroll scrolls window down, up, top, bottom, and by offset', () => {
  const { window } = createTestEnvironment(`<div>Content</div>`);

  let lastScrollBy: any = null;
  let lastScrollTo: any = null;

  (window as any).scrollBy = (opts: any) => {
    lastScrollBy = opts;
  };
  (window as any).scrollTo = (opts: any) => {
    lastScrollTo = opts;
  };

  // 1. Default / "down"
  simulateScroll(null, 'down');
  assert.deepEqual(lastScrollBy, { top: DEFAULT_SCROLL_OFFSET, behavior: 'smooth' });

  // 2. "up"
  simulateScroll(null, 'up');
  assert.deepEqual(lastScrollBy, { top: -DEFAULT_SCROLL_OFFSET, behavior: 'smooth' });

  // 3. "top"
  simulateScroll(null, 'top');
  assert.deepEqual(lastScrollTo, { top: 0, behavior: 'smooth' });

  // 4. Custom offset "350px"
  simulateScroll(null, '350px');
  assert.deepEqual(lastScrollBy, { top: 350, behavior: 'smooth' });

  // 5. Negative custom offset "-200"
  simulateScroll(null, '-200');
  assert.deepEqual(lastScrollBy, { top: -200, behavior: 'smooth' });
});

test('Slice 3.5 - resolveTargetElement finds elements registered in scanner and badges', () => {
  const { document } = createTestEnvironment(`
    <div>
      <button id="btn1">Button 1</button>
      <input id="inp1" type="text" />
      <a href="/login" id="link1">Login</a>
    </div>
  `);

  clearScannerRegistry();
  removeBadges();

  const elements = scanInteractiveElements({ showBadges: false, filterHidden: false });
  assert.equal(elements.length, 3);

  // Button 1 is ID #1
  const target1 = resolveTargetElement(1);
  assert.ok(target1);
  assert.equal(target1?.id, 'btn1');

  // Input 1 is ID #2
  const target2 = resolveTargetElement(2);
  assert.ok(target2);
  assert.equal(target2?.id, 'inp1');

  // Non-existent ID returns null
  assert.equal(resolveTargetElement(999), null);
  assert.equal(resolveTargetElement(null), null);
});

test('Slice 3.5 - executeAction end-to-end execution of click, type, select, scroll, and done', async () => {
  const { document } = createTestEnvironment(`
    <form id="jobForm">
      <input type="text" id="fullName" placeholder="Your Name" />
      <select id="role">
        <option value="eng">Software Engineer</option>
        <option value="pm">Product Manager</option>
      </select>
      <button type="button" id="submitBtn">Apply Now</button>
    </form>
  `);

  clearScannerRegistry();
  removeBadges();
  scanInteractiveElements({ showBadges: false, filterHidden: false });

  const inputEl = document.getElementById('fullName') as HTMLInputElement;
  const selectEl = document.getElementById('role') as HTMLSelectElement;
  const btnEl = document.getElementById('submitBtn') as HTMLButtonElement;

  let btnClicked = false;
  btnEl.addEventListener('click', () => {
    btnClicked = true;
  });

  // 1. Type action
  const typeStep: ActionStep = {
    action: 'type',
    targetId: 1, // input #fullName
    targetElementId: 1,
    value: 'Antriksh Developer',
    reason: 'Typing applicant name into name field',
    isConsequential: false,
  };
  const typeRes = await executeAction(typeStep);
  assert.equal(typeRes.success, true);
  assert.equal(typeRes.executed, true);
  assert.equal(inputEl.value, 'Antriksh Developer');

  // 2. Select action
  const selectStep: ActionStep = {
    action: 'select',
    targetId: 2, // select #role
    targetElementId: 2,
    value: 'Product Manager',
    reason: 'Selecting Product Manager role',
    isConsequential: false,
  };
  const selectRes = await executeAction(selectStep);
  assert.equal(selectRes.success, true);
  assert.equal(selectRes.executed, true);
  assert.equal(selectEl.value, 'pm');

  // 3. Click action
  const clickStep: ActionStep = {
    action: 'click',
    targetId: 3, // button #submitBtn
    targetElementId: 3,
    value: null,
    reason: 'Submitting job application form',
    isConsequential: true,
  };
  const clickRes = await executeAction(clickStep);
  assert.equal(clickRes.success, true);
  assert.equal(clickRes.executed, true);
  assert.equal(btnClicked, true);

  // 4. Scroll action
  const scrollStep: ActionStep = {
    action: 'scroll',
    targetId: null,
    value: 'down',
    reason: 'Scrolling down to review form confirmation',
    isConsequential: false,
  };
  const scrollRes = await executeAction(scrollStep);
  assert.equal(scrollRes.success, true);
  assert.equal(scrollRes.executed, true);

  // 5. Done action
  const doneStep: ActionStep = {
    action: 'done',
    targetId: null,
    value: null,
    reason: 'Task is complete',
    isConsequential: false,
  };
  const doneRes = await executeAction(doneStep);
  assert.equal(doneRes.success, true);
  assert.equal(doneRes.executed, true);
});

test('Slice 3.5 - executeAction validates safety and reports errors gracefully', async () => {
  const { document } = createTestEnvironment(`
    <div>
      <button id="disabledBtn" disabled>Disabled Action</button>
      <input id="readOnlyInp" readonly value="Locked" />
    </div>
  `);

  clearScannerRegistry();
  removeBadges();
  scanInteractiveElements({ showBadges: false, filterHidden: false });

  // 1. Missing step object
  const nullRes = await executeAction(null as any);
  assert.equal(nullRes.success, false);
  assert.equal(nullRes.executed, false);
  assert.ok(nullRes.error?.includes('Invalid'));

  // 2. Missing targetId for click
  const noTargetClick: ActionStep = {
    action: 'click',
    targetId: null,
    value: null,
    reason: 'Missing target',
    isConsequential: false,
  };
  const noTargetRes = await executeAction(noTargetClick);
  assert.equal(noTargetRes.success, false);
  assert.ok(noTargetRes.error?.includes('Target element ID is required'));

  // 3. Target element ID not found
  const nonExistentStep: ActionStep = {
    action: 'click',
    targetId: 888,
    value: null,
    reason: 'Ghost element',
    isConsequential: false,
  };
  const nonExistentRes = await executeAction(nonExistentStep);
  assert.equal(nonExistentRes.success, false);
  assert.ok(nonExistentRes.error?.includes('not found'));

  // 4. Interaction on disabled element
  const disabledStep: ActionStep = {
    action: 'click',
    targetId: 1, // disabled button
    value: null,
    reason: 'Attempt disabled click',
    isConsequential: false,
  };
  const disabledRes = await executeAction(disabledStep);
  assert.equal(disabledRes.success, false);
  assert.ok(disabledRes.error?.includes('disabled'));

  // 5. Type on read-only input
  const readOnlyStep: ActionStep = {
    action: 'type',
    targetId: 2, // readonly input
    value: 'Attempt write',
    reason: 'Attempt write to readonly',
    isConsequential: false,
  };
  const readOnlyRes = await executeAction(readOnlyStep);
  assert.equal(readOnlyRes.success, false);
  assert.ok(readOnlyRes.error?.includes('disabled or read-only'));

  // 6. Unsupported action primitive
  const badActionStep: any = {
    action: 'hover',
    targetId: 1,
    reason: 'Unsupported hover',
    isConsequential: false,
  };
  const badActionRes = await executeAction(badActionStep);
  assert.equal(badActionRes.success, false);
  assert.ok(badActionRes.error?.includes('Unsupported action'));
});

test('Slice 3.5 - registerExecutorListener handles EXECUTE_ACTION message asynchronously', async () => {
  const { document } = createTestEnvironment(`
    <button id="submit">Confirm Order</button>
  `);

  clearScannerRegistry();
  removeBadges();
  scanInteractiveElements({ showBadges: false, filterHidden: false });

  unregisterExecutorListener();

  let messageListener: any = null;
  const mockChrome = {
    runtime: {
      onMessage: {
        addListener: (fn: any) => {
          messageListener = fn;
        },
        removeListener: (fn: any) => {
          if (messageListener === fn) {
            messageListener = null;
          }
        },
      },
    },
  };

  (globalThis as any).chrome = mockChrome;

  registerExecutorListener();
  assert.ok(messageListener, 'Message listener should be registered');

  // Dispatch EXECUTE_ACTION message
  let capturedResponse: any = null;
  const step: ActionStep = {
    action: 'click',
    targetId: 1,
    value: null,
    reason: 'Confirm order step',
    isConsequential: true,
  };

  const isAsync = messageListener(
    { type: 'EXECUTE_ACTION', step },
    {},
    (res: any) => {
      capturedResponse = res;
    }
  );

  assert.equal(isAsync, true, 'Must return true for asynchronous sendResponse handling');

  // Allow promise to resolve
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(capturedResponse);
  assert.equal(capturedResponse.success, true);
  assert.equal(capturedResponse.executed, true);

  // Non-matching message should be ignored
  const ignoredResult = messageListener({ type: 'SOME_OTHER_EVENT' }, {}, () => {});
  assert.equal(ignoredResult, false);

  // Unregister listener
  unregisterExecutorListener();
  assert.equal(messageListener, null, 'Listener should be cleaned up');
});
