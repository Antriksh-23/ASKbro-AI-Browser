import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRestrictedUrl,
  getActiveTab,
  requestTabContentExtraction,
  seekActiveTabVideo,
} from '../src/services/reader/tabReader';

test('tabReader - isRestrictedUrl correctly distinguishes web pages from internal browser pages', () => {
  // Public web pages (Must NOT be restricted)
  assert.equal(isRestrictedUrl('https://www.hindustantimes.com/'), false);
  assert.equal(isRestrictedUrl('https://www.hindustantimes.com/india-news'), false);
  assert.equal(isRestrictedUrl('http://example.com/article'), false);
  assert.equal(isRestrictedUrl('https://news.ycombinator.com/'), false);
  assert.equal(isRestrictedUrl('https://en.wikipedia.org/wiki/India'), false);

  // Missing or empty URLs should not trigger restricted page errors
  assert.equal(isRestrictedUrl(''), false);
  assert.equal(isRestrictedUrl(undefined), false);

  // Browser internal & restricted URLs (Must be restricted)
  assert.equal(isRestrictedUrl('chrome://newtab/'), true);
  assert.equal(isRestrictedUrl('chrome://settings/'), true);
  assert.equal(isRestrictedUrl('chrome://extensions/'), true);
  assert.equal(isRestrictedUrl('chrome-extension://abcdefgh/sidepanel.html'), true);
  assert.equal(isRestrictedUrl('about:blank'), true);
  assert.equal(isRestrictedUrl('about:flags'), true);
  assert.equal(isRestrictedUrl('devtools://devtools/bundled/inspector.html'), true);
  assert.equal(isRestrictedUrl('edge://settings/'), true);
  assert.equal(isRestrictedUrl('view-source:https://www.hindustantimes.com/'), true);
  assert.equal(isRestrictedUrl('https://chromewebstore.google.com/detail/xyz'), true);
  assert.equal(isRestrictedUrl('https://chrome.google.com/webstore/category/extensions'), true);
});

test('tabReader - getActiveTab resolves active tab from currentWindow and falls back to lastFocusedWindow', async () => {
  const originalChrome = (globalThis as any).chrome;

  // Case 1: Active tab found in currentWindow
  (globalThis as any).chrome = {
    tabs: {
      query: async (queryInfo: any) => {
        if (queryInfo.currentWindow) {
          return [{ id: 42, url: 'https://www.hindustantimes.com/', title: 'Hindustan Times' }];
        }
        return [];
      },
    },
  };

  const tab1 = await getActiveTab();
  assert.ok(tab1);
  assert.equal(tab1?.id, 42);
  assert.equal(tab1?.url, 'https://www.hindustantimes.com/');

  // Case 2: currentWindow returns empty, falls back to lastFocusedWindow
  (globalThis as any).chrome = {
    tabs: {
      query: async (queryInfo: any) => {
        if (queryInfo.currentWindow) {
          return [];
        }
        if (queryInfo.lastFocusedWindow) {
          return [{ id: 99, url: 'https://news.google.com/', title: 'Google News' }];
        }
        return [];
      },
    },
  };

  const tab2 = await getActiveTab();
  assert.ok(tab2);
  assert.equal(tab2?.id, 99);
  assert.equal(tab2?.url, 'https://news.google.com/');

  // Restore chrome
  (globalThis as any).chrome = originalChrome;
});

test('tabReader - requestTabContentExtraction extracts content from news site without false internal page restriction', async () => {
  const originalChrome = (globalThis as any).chrome;

  let messageSentToTabId: number | null = null;
  let sentPayload: any = null;

  (globalThis as any).chrome = {
    tabs: {
      get: async (id: number) => ({
        id,
        url: 'https://www.hindustantimes.com/',
        title: 'Hindustan Times: Breaking News',
      }),
      query: async () => [
        {
          id: 101,
          url: 'https://www.hindustantimes.com/',
          title: 'Hindustan Times: Breaking News',
        },
      ],
      sendMessage: async (tabId: number, message: any) => {
        messageSentToTabId = tabId;
        sentPayload = message;
        return {
          success: true,
          title: 'Hindustan Times: Breaking News',
          url: 'https://www.hindustantimes.com/',
          textContent: 'Top headline of the day from India and around the world.',
          excerpt: 'Top headline...',
          wordCount: 150,
          readingTimeMinutes: 1,
          extractedWith: 'readability',
          timestamp: Date.now(),
        };
      },
    },
  };

  // Calling with tabId (as ChatView, SummaryCard, ArticleExtractCard do)
  const resultWithTabId = await requestTabContentExtraction(101);
  assert.equal(resultWithTabId.success, true);
  assert.equal(messageSentToTabId, 101);
  assert.equal(sentPayload.type, 'EXTRACT_PAGE_CONTENT');
  assert.equal(resultWithTabId.title, 'Hindustan Times: Breaking News');
  assert.ok(resultWithTabId.textContent.includes('Top headline'));

  // Calling without tabId (relying on getActiveTab)
  const resultWithoutTabId = await requestTabContentExtraction();
  assert.equal(resultWithoutTabId.success, true);
  assert.equal(resultWithoutTabId.wordCount, 150);

  // Restore chrome
  (globalThis as any).chrome = originalChrome;
});

test('tabReader - requestTabContentExtraction throws restriction error on internal pages', async () => {
  const originalChrome = (globalThis as any).chrome;

  (globalThis as any).chrome = {
    tabs: {
      get: async (id: number) => ({
        id,
        url: 'chrome://newtab/',
        title: 'New Tab',
      }),
      query: async () => [{ id: 50, url: 'chrome://newtab/', title: 'New Tab' }],
      sendMessage: async () => ({ success: true }),
    },
  };

  await assert.rejects(
    async () => {
      await requestTabContentExtraction(50);
    },
    /Browser security restricts extensions from reading internal pages/
  );

  (globalThis as any).chrome = originalChrome;
});

test('tabReader - requestTabContentExtraction dynamically injects script if receiving end does not exist', async () => {
  const originalChrome = (globalThis as any).chrome;

  let dynamicInjectionOccurred = false;
  let callCount = 0;

  (globalThis as any).chrome = {
    runtime: {
      getManifest: () => ({
        content_scripts: [{ js: ['assets/content.js'] }],
      }),
    },
    scripting: {
      executeScript: async ({ target, files }: any) => {
        dynamicInjectionOccurred = true;
        assert.equal(target.tabId, 202);
        assert.deepEqual(files, ['assets/content.js']);
      },
    },
    tabs: {
      get: async (id: number) => ({
        id,
        url: 'https://www.hindustantimes.com/india-news',
        title: 'India News - Hindustan Times',
      }),
      sendMessage: async (_tabId: number, _msg: any) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return {
          success: true,
          title: 'India News - Hindustan Times',
          url: 'https://www.hindustantimes.com/india-news',
          textContent: 'Latest updates from India.',
          wordCount: 80,
          readingTimeMinutes: 1,
          extractedWith: 'readability',
          timestamp: Date.now(),
        };
      },
    },
  };

  const response = await requestTabContentExtraction(202);
  assert.equal(dynamicInjectionOccurred, true);
  assert.equal(response.success, true);
  assert.ok(response.textContent.includes('Latest updates'));

  (globalThis as any).chrome = originalChrome;
});

