import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  scanInteractiveElements,
  isElementInteractive,
  extractElementMetadata,
  getElementById,
  getIdByElement,
  clearScannerRegistry,
  registerScannerListener,
} from '../src/content/scanner';
import {
  renderBadges,
  removeBadges,
  repositionBadges,
  highlightElement,
  removeHighlight,
  getBadgeOverlayHost,
  isBadgesActive,
  getTrackedBadges,
  BADGE_ROOT_ID,
} from '../src/content/badges';
import { isElementVisible, isRectInViewport } from '../src/utils/domUtils';

/**
 * Helper to create a JSDOM document with simulated window environment
 */
function createTestEnvironment(html: string) {
  const dom = new JSDOM(html, {
    url: 'https://askbro.test/page',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  // Set up globals needed by scanner and badges
  (global as any).window = window;
  (global as any).document = document;
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).Element = window.Element;
  (global as any).HTMLInputElement = window.HTMLInputElement;
  (global as any).HTMLSelectElement = window.HTMLSelectElement;
  (global as any).HTMLButtonElement = window.HTMLButtonElement;
  (global as any).HTMLAnchorElement = window.HTMLAnchorElement;

  return { dom, window, document };
}

test('Slice 3.1 - isElementInteractive classifies interactive and non-interactive nodes', () => {
  const { document } = createTestEnvironment(`
    <div>
      <p id="p1">Static paragraph</p>
      <span id="s1">Plain span</span>
      <h1 id="h1">Header</h1>
      <button id="btn1">Click me</button>
      <a href="https://example.com" id="a1">Link</a>
      <a id="a2">Anchor without href</a>
      <a role="button" id="a3">Anchor with role</a>
      <input type="text" id="inp1" />
      <input type="hidden" id="inpHidden" />
      <textarea id="txt1"></textarea>
      <select id="sel1"><option>One</option></select>
      <div role="button" id="divRoleBtn">Fake button</div>
      <div role="checkbox" id="divRoleCb">Fake checkbox</div>
      <div tabindex="0" id="divTabindex0">Tabindex 0</div>
      <div tabindex="-1" id="divTabindexNeg1">Tabindex -1</div>
      <div contenteditable="true" id="editableDiv">Editable</div>
      <summary id="summary1">Summary header</summary>
    </div>
  `);

  // Interactive
  assert.equal(isElementInteractive(document.getElementById('btn1')!), true);
  assert.equal(isElementInteractive(document.getElementById('a1')!), true);
  assert.equal(isElementInteractive(document.getElementById('a3')!), true);
  assert.equal(isElementInteractive(document.getElementById('inp1')!), true);
  assert.equal(isElementInteractive(document.getElementById('txt1')!), true);
  assert.equal(isElementInteractive(document.getElementById('sel1')!), true);
  assert.equal(isElementInteractive(document.getElementById('divRoleBtn')!), true);
  assert.equal(isElementInteractive(document.getElementById('divRoleCb')!), true);
  assert.equal(isElementInteractive(document.getElementById('divTabindex0')!), true);
  assert.equal(isElementInteractive(document.getElementById('editableDiv')!), true);
  assert.equal(isElementInteractive(document.getElementById('summary1')!), true);

  // Non-interactive
  assert.equal(isElementInteractive(document.getElementById('p1')!), false);
  assert.equal(isElementInteractive(document.getElementById('s1')!), false);
  assert.equal(isElementInteractive(document.getElementById('h1')!), false);
  assert.equal(isElementInteractive(document.getElementById('a2')!), false);
  assert.equal(isElementInteractive(document.getElementById('inpHidden')!), false);
  assert.equal(isElementInteractive(document.getElementById('divTabindexNeg1')!), false);
});

test('Slice 3.1 - isElementVisible and hidden element filtering', () => {
  const { document } = createTestEnvironment(`
    <div>
      <button id="visibleBtn">Visible</button>
      <button id="hiddenAttrBtn" hidden>Hidden Attr</button>
      <button id="ariaHiddenBtn" aria-hidden="true">Aria Hidden</button>
      <button id="displayNoneBtn" style="display: none;">Display None</button>
      <button id="visHiddenBtn" style="visibility: hidden;">Visibility Hidden</button>
      <button id="visCollapseBtn" style="visibility: collapse;">Visibility Collapse</button>
      <button id="opacityZeroBtn" style="opacity: 0;">Opacity Zero</button>
      <button id="smallWidthBtn">Small Width</button>
      <button id="smallHeightBtn">Small Height</button>
      <button id="tinyBtn">Tiny Both</button>
      <button id="validMinSizeBtn">Exact Min Size</button>
    </div>
  `);

  const mockRect = (el: HTMLElement, width: number, height: number) => {
    el.getBoundingClientRect = () => ({
      top: 10,
      left: 10,
      bottom: 10 + height,
      right: 10 + width,
      width,
      height,
      x: 10,
      y: 10,
      toJSON: () => {},
    });
  };

  const visibleBtn = document.getElementById('visibleBtn')!;
  mockRect(visibleBtn, 100, 30);
  assert.equal(isElementVisible(visibleBtn, 5), true);

  // Hidden attribute
  const hiddenAttrBtn = document.getElementById('hiddenAttrBtn')!;
  mockRect(hiddenAttrBtn, 100, 30);
  assert.equal(isElementVisible(hiddenAttrBtn, 5), false);

  // Aria hidden
  const ariaHiddenBtn = document.getElementById('ariaHiddenBtn')!;
  mockRect(ariaHiddenBtn, 100, 30);
  assert.equal(isElementVisible(ariaHiddenBtn, 5), false);

  // CSS display: none
  const displayNoneBtn = document.getElementById('displayNoneBtn')!;
  mockRect(displayNoneBtn, 100, 30);
  assert.equal(isElementVisible(displayNoneBtn, 5), false);

  // CSS visibility: hidden
  const visHiddenBtn = document.getElementById('visHiddenBtn')!;
  mockRect(visHiddenBtn, 100, 30);
  assert.equal(isElementVisible(visHiddenBtn, 5), false);

  // CSS opacity: 0
  const opacityZeroBtn = document.getElementById('opacityZeroBtn')!;
  mockRect(opacityZeroBtn, 100, 30);
  assert.equal(isElementVisible(opacityZeroBtn, 5), false);

  // Width < 5px
  const smallWidthBtn = document.getElementById('smallWidthBtn')!;
  mockRect(smallWidthBtn, 4, 20);
  assert.equal(isElementVisible(smallWidthBtn, 5), false);

  // Height < 5px
  const smallHeightBtn = document.getElementById('smallHeightBtn')!;
  mockRect(smallHeightBtn, 20, 4);
  assert.equal(isElementVisible(smallHeightBtn, 5), false);

  // Tiny (0x0)
  const tinyBtn = document.getElementById('tinyBtn')!;
  mockRect(tinyBtn, 0, 0);
  assert.equal(isElementVisible(tinyBtn, 5), false);

  // Valid min size (5x5)
  const validMinSizeBtn = document.getElementById('validMinSizeBtn')!;
  mockRect(validMinSizeBtn, 5, 5);
  assert.equal(isElementVisible(validMinSizeBtn, 5), true);
});

test('Slice 3.1 - isRectInViewport detection', () => {
  const viewport = { width: 1000, height: 800 };

  // Fully visible in center
  assert.equal(isRectInViewport({ top: 100, left: 100, width: 200, height: 50 }, viewport), true);

  // Offscreen above
  assert.equal(isRectInViewport({ top: -100, left: 100, height: 50, bottom: -50 }, viewport), false);

  // Offscreen below
  assert.equal(isRectInViewport({ top: 900, left: 100, height: 50, bottom: 950 }, viewport), false);

  // Offscreen left
  assert.equal(isRectInViewport({ top: 100, left: -200, width: 100, right: -100 }, viewport), false);

  // Offscreen right
  assert.equal(isRectInViewport({ top: 100, left: 1200, width: 100, right: 1300 }, viewport), false);
});

test('Slice 3.1 - scanInteractiveElements assigns sequential IDs 1, 2, 3...', () => {
  const { document } = createTestEnvironment(`
    <form id="test-form">
      <input type="text" name="username" placeholder="Enter username" id="input-username" />
      <input type="password" name="password" placeholder="Password" id="input-password" />
      <button type="submit" id="btn-submit">Log In</button>
      <a href="/forgot-password" id="link-forgot">Forgot Password?</a>
      <div role="button" tabindex="0" id="btn-custom" aria-label="Custom Action">Custom Action</div>
    </form>
  `);

  // Mock layout sizes for all candidates
  const form = document.getElementById('test-form')!;
  const elements = form.querySelectorAll('input, button, a, div[role="button"]');
  elements.forEach((el, index) => {
    (el as HTMLElement).getBoundingClientRect = () => ({
      top: 50 + index * 40,
      left: 100,
      bottom: 80 + index * 40,
      right: 300,
      width: 200,
      height: 30,
      x: 100,
      y: 50 + index * 40,
      toJSON: () => {},
    });
  });

  const scanned = scanInteractiveElements({ root: form, minSize: 5, filterSensitive: false });

  assert.equal(scanned.length, 5);
  assert.deepEqual(
    scanned.map((s) => s.id),
    [1, 2, 3, 4, 5]
  );

  // Verify elements are properly tracked in registry
  assert.equal(getElementById(1), document.getElementById('input-username'));
  assert.equal(getElementById(2), document.getElementById('input-password'));
  assert.equal(getElementById(3), document.getElementById('btn-submit'));
  assert.equal(getElementById(4), document.getElementById('link-forgot'));
  assert.equal(getElementById(5), document.getElementById('btn-custom'));

  assert.equal(getIdByElement(document.getElementById('input-username')!), 1);
  assert.equal(getIdByElement(document.getElementById('btn-submit')!), 3);
});

test('Slice 3.1 - extractElementMetadata extracts tag, text, placeholder, aria-label, rect', () => {
  const { document } = createTestEnvironment(`
    <div>
      <input type="text" name="email_field" placeholder="you@domain.com" aria-label="User Email Address" id="email" />
      <button type="button" aria-label="Cancel current edit" id="btn-cancel">Cancel Operation</button>
      <select name="country" id="country-select">
        <option value="us">United States</option>
        <option value="in" selected>India</option>
      </select>
      <a href="https://askbro.ai/docs" title="Documentation Link" id="docs-link">Documentation Hub</a>
    </div>
  `);

  const email = document.getElementById('email')!;
  email.getBoundingClientRect = () => ({
    top: 25,
    left: 40,
    bottom: 55,
    right: 240,
    width: 200,
    height: 30,
    x: 40,
    y: 25,
    toJSON: () => {},
  });

  const metaEmail = extractElementMetadata(email, 1);
  assert.equal(metaEmail.id, 1);
  assert.equal(metaEmail.tag, 'input');
  assert.equal(metaEmail.type, 'text');
  assert.equal(metaEmail.placeholder, 'you@domain.com');
  assert.equal(metaEmail.ariaLabel, 'User Email Address');
  assert.equal(metaEmail.name, 'email_field');
  assert.deepEqual(metaEmail.rect, { top: 25, left: 40, width: 200, height: 30 });

  const cancelBtn = document.getElementById('btn-cancel')!;
  cancelBtn.getBoundingClientRect = () => ({
    top: 60,
    left: 40,
    bottom: 90,
    right: 140,
    width: 100,
    height: 30,
    x: 40,
    y: 60,
    toJSON: () => {},
  });
  const metaCancel = extractElementMetadata(cancelBtn, 2);
  assert.equal(metaCancel.text, 'Cancel Operation');
  assert.equal(metaCancel.ariaLabel, 'Cancel current edit');
  assert.equal(metaCancel.tag, 'button');

  const select = document.getElementById('country-select')!;
  const metaSelect = extractElementMetadata(select, 3);
  assert.equal(metaSelect.text, 'India');
  assert.equal(metaSelect.tag, 'select');

  const link = document.getElementById('docs-link')!;
  const metaLink = extractElementMetadata(link, 4);
  assert.equal(metaLink.text, 'Documentation Hub');
  assert.equal(metaLink.href, 'https://askbro.ai/docs');
  assert.equal(metaLink.ariaLabel, 'Documentation Link');
});

test('Slice 3.1 - Closed Shadow DOM Overlay (#askbro-badge-root) injection and isolation', () => {
  const { document } = createTestEnvironment(`
    <div id="content">
      <button id="b1">Submit</button>
      <button id="b2">Reset</button>
    </div>
  `);

  const b1 = document.getElementById('b1')!;
  const b2 = document.getElementById('b2')!;

  b1.getBoundingClientRect = () => ({
    top: 50,
    left: 50,
    bottom: 80,
    right: 150,
    width: 100,
    height: 30,
    x: 50,
    y: 50,
    toJSON: () => {},
  });
  b2.getBoundingClientRect = () => ({
    top: 100,
    left: 50,
    bottom: 130,
    right: 150,
    width: 100,
    height: 30,
    x: 50,
    y: 100,
    toJSON: () => {},
  });

  // Render badges
  renderBadges([
    { id: 1, element: b1 },
    { id: 2, element: b2 },
  ]);

  assert.equal(isBadgesActive(), true);

  const overlayHost = document.getElementById(BADGE_ROOT_ID);
  assert.ok(overlayHost, 'Overlay host must exist in document');
  assert.equal(overlayHost, getBadgeOverlayHost());

  // Closed shadow DOM: shadowRoot property is null from outside
  assert.equal(overlayHost.shadowRoot, null, 'Closed shadow root must not be accessible via host.shadowRoot');

  // Verify non-destructive pointer-events
  assert.ok(overlayHost.style.cssText.includes('pointer-events: none'));

  // Tracked items
  const tracked = getTrackedBadges();
  assert.equal(tracked.length, 2);
  assert.equal(tracked[0].badgeEl.textContent, '1');
  assert.equal(tracked[1].badgeEl.textContent, '2');
  assert.equal(tracked[0].badgeEl.style.top, '50px');
  assert.equal(tracked[0].badgeEl.style.left, '50px');

  // Clean teardown
  removeBadges();
  assert.equal(isBadgesActive(), false);
  assert.equal(document.getElementById(BADGE_ROOT_ID), null);
  assert.equal(getTrackedBadges().length, 0);
});

test('Slice 3.1 - recalculates badge positions on repositionBadges()', () => {
  const { document } = createTestEnvironment(`
    <button id="dynBtn">Dynamic Pos</button>
  `);

  const btn = document.getElementById('dynBtn')!;
  let currentTop = 100;
  let currentLeft = 150;

  btn.getBoundingClientRect = () => ({
    top: currentTop,
    left: currentLeft,
    bottom: currentTop + 30,
    right: currentLeft + 80,
    width: 80,
    height: 30,
    x: currentLeft,
    y: currentTop,
    toJSON: () => {},
  });

  renderBadges([{ id: 1, element: btn }]);
  let tracked = getTrackedBadges();
  assert.equal(tracked[0].badgeEl.style.top, '100px');
  assert.equal(tracked[0].badgeEl.style.left, '150px');

  // Simulate user scrolling or window resize shifting element
  currentTop = 220;
  currentLeft = 310;
  repositionBadges();

  tracked = getTrackedBadges();
  assert.equal(tracked[0].badgeEl.style.top, '220px');
  assert.equal(tracked[0].badgeEl.style.left, '310px');

  // Simulate scrolling element offscreen
  currentTop = -500;
  repositionBadges();
  assert.equal(tracked[0].badgeEl.style.display, 'none');

  removeBadges();
});

test('Slice 3.1 - highlightElement pulses badge and outlines element for Dry Run & Find-It', () => {
  const { document } = createTestEnvironment(`
    <div>
      <input type="file" id="resumeUpload" />
      <button id="otherBtn">Other</button>
    </div>
  `);

  const uploadInput = document.getElementById('resumeUpload')!;
  uploadInput.getBoundingClientRect = () => ({
    top: 150,
    left: 200,
    bottom: 190,
    right: 400,
    width: 200,
    height: 40,
    x: 200,
    y: 150,
    toJSON: () => {},
  });

  let scrolled = false;
  uploadInput.scrollIntoView = () => {
    scrolled = true;
  };

  renderBadges([{ id: 4, element: uploadInput }]);

  // Highlight badge #4
  const found = highlightElement(4, 5000);
  assert.equal(found, true);
  assert.equal(scrolled, true, 'Target element must be smoothly scrolled into view');

  const tracked = getTrackedBadges();
  assert.equal(tracked[0].badgeEl.classList.contains('askbro-highlighted'), true);

  // Highlighting non-existent ID returns false
  const notFound = highlightElement(999);
  assert.equal(notFound, false);

  // Clear highlight
  removeHighlight();
  assert.equal(tracked[0].badgeEl.classList.contains('askbro-highlighted'), false);

  removeBadges();
});

test('Slice 3.1 - registerScannerListener runtime messaging integration', () => {
  const { document } = createTestEnvironment(`
    <div id="app">
      <button id="actionBtn">Save Changes</button>
    </div>
  `);

  const btn = document.getElementById('actionBtn')!;
  btn.getBoundingClientRect = () => ({
    top: 50,
    left: 50,
    bottom: 80,
    right: 150,
    width: 100,
    height: 30,
    x: 50,
    y: 50,
    toJSON: () => {},
  });

  // Mock chrome.runtime messaging
  let listenerCallback: any = null;
  (global as any).chrome = {
    runtime: {
      onMessage: {
        addListener: (cb: any) => {
          listenerCallback = cb;
        },
      },
    },
  };

  registerScannerListener();
  assert.ok(listenerCallback, 'Runtime message listener must be registered');

  // Test SCAN_ELEMENTS
  let scanResult: any = null;
  listenerCallback({ type: 'SCAN_ELEMENTS', showBadges: true }, {}, (res: any) => {
    scanResult = res;
  });

  assert.equal(scanResult.success, true);
  assert.equal(scanResult.count, 1);
  assert.equal(scanResult.elements[0].text, 'Save Changes');
  assert.equal(isBadgesActive(), true);

  // Test DRY_RUN_HIGHLIGHT
  let highlightResult: any = null;
  listenerCallback({ type: 'DRY_RUN_HIGHLIGHT', targetElementId: 1, durationMs: 1000 }, {}, (res: any) => {
    highlightResult = res;
  });
  assert.equal(highlightResult.success, true);
  assert.equal(highlightResult.found, true);

  // Test REMOVE_BADGES
  let removeResult: any = null;
  listenerCallback({ type: 'REMOVE_BADGES' }, {}, (res: any) => {
    removeResult = res;
  });
  assert.equal(removeResult.success, true);
  assert.equal(isBadgesActive(), false);
});

