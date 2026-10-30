/**
 * ASKbro Content Script Entry Point
 */

console.log('[ASKbro Content Script] Initialized on:', window.location.href);

// Listen for messages from background worker or side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CONTENT_PING') {
    sendResponse({ status: 'PONG', url: window.location.href, title: document.title });
    return true;
  }
  return true;
});
