/**
 * ASKbro Service Worker (Background Script) - Manifest V3
 */

// Enable side panel to open upon clicking the extension action toolbar icon
if (chrome.sidePanel && 'setPanelBehavior' in chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('[ASKbro Service Worker] Error configuring side panel behavior:', error);
    });
}

// Extension installation & update lifecycle
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ASKbro Service Worker] Extension installed/updated:', details.reason);
  
  // Set up context menu skeletons if needed in Phase 2
  if (chrome.contextMenus) {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'askbro-explain',
        title: 'Explain with ASKbro',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'askbro-translate',
        title: 'Translate to Hinglish/Hindi',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'askbro-reply',
        title: 'Draft reply with ASKbro',
        contexts: ['selection'],
      });
    });
  }
});

// Handle context menu clicks
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('[ASKbro Service Worker] Context menu item clicked:', info.menuItemId, 'on tab:', tab?.id);
    if (tab?.id && chrome.sidePanel && 'open' in chrome.sidePanel) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
        console.warn('[ASKbro Service Worker] Could not open side panel on context menu click:', err);
      });
    }
  });
}

// Runtime message listener for communication between Side Panel, Background, and Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ASKbro Service Worker] Message received:', message?.type, 'from:', sender.id || sender.url);

  if (message?.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return true;
  }

  return true;
});

console.log('[ASKbro Service Worker] Background service worker initialized.');
