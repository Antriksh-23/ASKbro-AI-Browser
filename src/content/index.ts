/**
 * ASKbro Content Script Entry Point
 */

import { registerReaderListener } from './reader';
import { registerYouTubeListener } from './youtube';
import { registerScannerListener } from './scanner';
import { registerExecutorListener } from './executor';
import { registerSelectionListener } from './selection';

console.log('[ASKbro Content Script] Initialized on:', window.location.href);

// 1. Register Article & Page Extractor listener (Slice 1.3)
registerReaderListener();

// 2. Register YouTube seek & controller listener (Slice 1.5)
registerYouTubeListener();

// 3. Register Interactive Element Scanner & Shadow DOM Badges listener (Slice 3.1)
registerScannerListener();

// 4. Register Action Executor listener (Slice 3.5)
registerExecutorListener();

// 5. Register in-page selection highlight & floating explain trigger
registerSelectionListener();

// 2. Generic content ping and selection listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CONTENT_PING') {
    sendResponse({
      status: 'PONG',
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
    });
    return true;
  }

  if (message?.type === 'GET_SELECTED_TEXT') {
    try {
      const selected = window.getSelection()?.toString() || '';
      sendResponse({
        success: true,
        selectedText: selected.trim(),
      });
    } catch (err) {
      sendResponse({
        success: false,
        selectedText: '',
        error: String(err),
      });
    }
    return true;
  }

  return false;
});
