/**
 * ASKbro Tab Content Extraction Client
 * Communicates with the active tab's content script to extract article and page content
 */

import {
  ExtractPageContentOptions,
  PageContentResponse,
  SeekVideoResponse,
} from '../../types/messages';

/**
 * Checks if a URL cannot be scripted due to Chrome security boundaries
 */
export function isRestrictedUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed === 'about:blank') return true;
  return (
    trimmed.startsWith('chrome://') ||
    trimmed.startsWith('chrome-extension://') ||
    trimmed.startsWith('devtools://') ||
    trimmed.startsWith('edge://') ||
    trimmed.startsWith('about:') ||
    trimmed.startsWith('view-source:') ||
    trimmed.includes('chrome.google.com/webstore') ||
    trimmed.includes('chromewebstore.google.com')
  );
}

/**
 * Gets the currently active tab in the current window (with fallback to last focused window)
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0]?.id) {
      return tabs[0];
    }
  } catch (err) {
    console.warn('[ASKbro TabReader] Error querying currentWindow tabs:', err);
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs.length > 0 && tabs[0]?.id) {
      return tabs[0];
    }
  } catch (err) {
    console.warn('[ASKbro TabReader] Error querying lastFocusedWindow tabs:', err);
  }

  return null;
}

/**
 * Ensures the content script is injected into the target tab
 */
async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.scripting) {
    return false;
  }

  try {
    const manifest = chrome.runtime.getManifest();
    const contentScripts = manifest.content_scripts?.[0]?.js;

    if (contentScripts && contentScripts.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: contentScripts,
      });
      // Short delay to allow content script initialization and listener registration
      await new Promise((resolve) => setTimeout(resolve, 60));
      return true;
    }
  } catch (error) {
    console.warn('[ASKbro TabReader] Could not inject content script:', error);
  }

  return false;
}

/**
 * Requests article/page text extraction from a tab via message passing
 */
export async function requestTabContentExtraction(
  tabId?: number,
  options?: ExtractPageContentOptions
): Promise<PageContentResponse> {
  // 1. Identify target tab
  let targetTabId = tabId;
  let targetTabUrl = '';

  if (!targetTabId) {
    const activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) {
      throw new Error('No active browser tab found. Please focus a web page.');
    }
    targetTabId = activeTab.id;
    targetTabUrl = activeTab.url || '';
  } else {
    // If tabId was provided, retrieve URL to validate security boundaries
    if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(targetTabId);
        targetTabUrl = tab?.url || '';
      } catch (err) {
        console.warn('[ASKbro TabReader] Could not get tab info for tabId', targetTabId, err);
      }
    }
    // Fallback to active tab URL if chrome.tabs.get did not resolve
    if (!targetTabUrl) {
      const activeTab = await getActiveTab();
      if (activeTab && activeTab.id === targetTabId) {
        targetTabUrl = activeTab.url || '';
      }
    }
  }

  // 2. Validate URL restrictions only when URL is present and matches restricted internal schemes
  if (targetTabUrl && isRestrictedUrl(targetTabUrl)) {
    throw new Error(
      'Browser security restricts extensions from reading internal pages (like chrome:// or about:blank). Please open any public web page or article.'
    );
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
    throw new Error('Chrome tabs extension runtime is not available.');
  }

  // 3. Send message to content script
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, {
      type: 'EXTRACT_PAGE_CONTENT',
      options,
    });

    if (response) {
      return response as PageContentResponse;
    }
    throw new Error('Received empty response from content reader script.');
  } catch (error: any) {
    // 4. Handle disconnected or not-yet-injected content script (e.g. tabs opened before extension install)
    const errorMsg = String(error?.message || error);
    if (
      errorMsg.includes('Could not establish connection') ||
      errorMsg.includes('Receiving end does not exist')
    ) {
      console.log('[ASKbro TabReader] Content script not detected, attempting dynamic injection...');
      const injected = await ensureContentScriptInjected(targetTabId);

      if (injected) {
        // Retry extraction after injection
        const retryResponse = await chrome.tabs.sendMessage(targetTabId, {
          type: 'EXTRACT_PAGE_CONTENT',
          options,
        });

        if (retryResponse) {
          return retryResponse as PageContentResponse;
        }
      }

      throw new Error(
        'Could not connect to this page. Please refresh the page tab (F5) so ASKbro can inspect the content.'
      );
    }

    throw error;
  }
}

/**
 * Sends a message to the active tab to seek its HTML5 video player to a given timestamp in seconds
 */
export async function seekActiveTabVideo(
  seconds: number,
  tabId?: number
): Promise<SeekVideoResponse> {
  let targetTabId = tabId;

  if (!targetTabId) {
    const activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) {
      throw new Error('No active browser tab found to control video.');
    }
    targetTabId = activeTab.id;
  }

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, {
      type: 'SEEK_VIDEO',
      seconds,
    });

    if (response) {
      return response as SeekVideoResponse;
    }
    return { success: false, error: 'No response from video controller.' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ASKbro TabReader] Error sending SEEK_VIDEO to tab:', err);
    return { success: false, error: msg };
  }
}


