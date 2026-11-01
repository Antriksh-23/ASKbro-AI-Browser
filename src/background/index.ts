/**
 * ASKbro Service Worker (Background Script) - Manifest V3
 */

import {
  initContextMenuHandlers,
  getPendingContextAction,
  clearPendingContextAction,
  setPendingContextAction,
} from './menuHandler';
import { handleCaptureScreenshotMessage } from './captureHandler';
import { chatWithPage } from '../services/ai/groundedChat';
import { locateAndHighlightElement } from '../services/ai/actionMap';
import { requestTabContentExtraction } from '../services/reader/tabReader';
import {
  initWorkerSessionSupport,
  handleStateManagerMessage,
} from './stateManager';
import {
  QueryPageChatMessage,
  QueryPageChatResponse,
  CaptureScreenshotMessage,
  FindElementMessage,
} from '../types/messages';

/**
 * Handles QUERY_PAGE_CHAT message passing between components
 */
async function handleQueryPageChat(message: QueryPageChatMessage): Promise<QueryPageChatResponse> {
  try {
    let pageContext = message.pageContext || '';
    let pageTitle = message.pageTitle || '';
    let pageUrl = message.pageUrl || '';

    // If context was not attached, extract active tab DOM content
    if (!pageContext) {
      const extracted = await requestTabContentExtraction();
      pageContext = extracted.textContent;
      pageTitle = extracted.title || pageTitle;
      pageUrl = extracted.url || pageUrl;
    }

    const result = await chatWithPage({
      pageContext,
      pageTitle,
      pageUrl,
      message: message.query,
      history: message.history || [],
      language: message.language,
    });

    return {
      success: true,
      answer: result.text,
      isNotFoundOnPage: result.isNotFoundOnPage,
    };
  } catch (err: any) {
    console.error('[ASKbro Service Worker] Error in handleQueryPageChat:', err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

// Enable side panel to open upon clicking the extension action toolbar icon
if (typeof chrome !== 'undefined') {
  // 1. Configure panel behavior on install / update (where SW context is guaranteed ready)
  if (chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      if (chrome.sidePanel && 'setPanelBehavior' in chrome.sidePanel) {
        chrome.sidePanel
          .setPanelBehavior({ openPanelOnActionClick: true })
          .catch((error: unknown) => {
            console.debug('[ASKbro Service Worker] Notice setting side panel behavior onInstalled:', error);
          });
      }
    });
  }

  // 2. Also attempt top-level configuration with graceful catch (avoids logging error if SW is warming up)
  if (chrome.sidePanel && 'setPanelBehavior' in chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        // If SW is not yet active during cold start, onInstalled or action.onClicked will handle it
        console.debug('[ASKbro Service Worker] Notice configuring side panel behavior:', error);
      });
  }

  // 3. Fallback toolbar action click listener to guarantee opening the side panel
  if (chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(async (tab) => {
      if (chrome.sidePanel && 'open' in chrome.sidePanel) {
        try {
          if (tab?.id) {
            await chrome.sidePanel.open({ tabId: tab.id });
          } else if (tab?.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
          }
        } catch (err) {
          console.debug('[ASKbro Service Worker] Notice opening side panel from action click:', err);
        }
      }
    });
  }
}

// Initialize Context Menu Handlers (Slice 2.2: Explain, Translate, Draft)
initContextMenuHandlers();

// Initialize Worker Session Support (Slice 3.6: Worker Hibernation & Session State Persistence)
initWorkerSessionSupport().catch((err) => {
  console.debug('[ASKbro Service Worker] Notice initializing session support:', err);
});

// Handle browser startup wake-up to recover uncompleted sessions
if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    initWorkerSessionSupport().catch((err) => {
      console.debug('[ASKbro Service Worker] onStartup wake-up handler notice:', err);
    });
  });
}

// Runtime message listener for communication between Side Panel, Background, and Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ASKbro Service Worker] Message received:', message?.type, 'from:', sender.id || sender.url);

  if (message?.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return true;
  }

  // Slice 3.6: Worker Hibernation & Session State Persistence Messages
  if (
    message?.type === 'GET_AGENT_SESSION' ||
    message?.type === 'SAVE_AGENT_SESSION' ||
    message?.type === 'CLEAR_AGENT_SESSION' ||
    message?.type === 'RECORD_AUDIT_LOG' ||
    message?.type === 'GET_AUDIT_LOG' ||
    message?.type === 'CLEAR_AUDIT_LOG' ||
    message?.type === 'AGENT_HEARTBEAT' ||
    message?.type === 'CHECK_WORKER_WAKEUP'
  ) {
    handleStateManagerMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'GET_PENDING_CONTEXT_ACTION') {
    getPendingContextAction()
      .then((action) => sendResponse({ success: true, action }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // Keep message channel open for async response
  }

  if (message?.type === 'CLEAR_PENDING_CONTEXT_ACTION') {
    clearPendingContextAction()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'EXPLAIN_HIGHLIGHTED_TEXT') {
    const tabId = sender.tab?.id;
    const selectedText = (message.payload?.selectedText || '').trim();
    if (!selectedText) {
      sendResponse({ success: false, error: 'No text selected to explain.' });
      return true;
    }

    const payload = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      action: 'explain' as const,
      selectedText,
      pageTitle: message.payload?.pageTitle || sender.tab?.title,
      pageUrl: message.payload?.pageUrl || sender.tab?.url,
      tabId,
      timestamp: Date.now(),
    };

    setPendingContextAction(payload)
      .then(async () => {
        if (tabId && chrome.sidePanel && 'open' in chrome.sidePanel) {
          try {
            await chrome.sidePanel.open({ tabId });
          } catch (err) {
            console.debug('[ASKbro Service Worker] Notice opening side panel from explain trigger:', err);
          }
        }
        chrome.runtime
          .sendMessage({
            type: 'CONTEXT_MENU_ACTION',
            payload,
          })
          .catch(() => {});
        sendResponse({ success: true, payload });
      })
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'QUERY_PAGE_CHAT') {
    handleQueryPageChat(message as QueryPageChatMessage)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'CAPTURE_SCREENSHOT') {
    handleCaptureScreenshotMessage(message as CaptureScreenshotMessage)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'FIND_ELEMENT_ON_PAGE') {
    const findMsg = message as FindElementMessage;
    locateAndHighlightElement({
      query: findMsg.query,
      tabId: findMsg.tabId,
      language: findMsg.language,
    })
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          success: false,
          found: false,
          targetElementId: null,
          reason: err?.message || String(err),
          highlighted: false,
          error: String(err?.message || err),
        })
      );
    return true;
  }

  return true;
});

console.log('[ASKbro Service Worker] Background service worker initialized.');
