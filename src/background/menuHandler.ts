/**
 * ASKbro Context Menu Handler Service Worker Module (Slice 2.2)
 *
 * Implements:
 * - Registration of right-click context menus:
 *   - askbro-explain: "Explain this with ASKbro"
 *   - askbro-translate: "Translate to Hindi/Hinglish"
 *   - askbro-reply: "Draft a reply to this"
 * - Capturing selection text via info.selectionText
 * - Auto-activation of the Chrome side panel on click (chrome.sidePanel.open)
 * - Session/Local storage staging for seamless side-panel cold-start pickup
 * - Broadcast of CONTEXT_MENU_ACTION runtime messages for already-open panels
 */

import { ContextActionType, ContextMenuActionPayload, ContextMenuActionMessage } from '../types/messages';
import { getLocalStorage, setLocalStorage, removeLocalStorage } from '../services/storage/index';

export const CONTEXT_MENU_IDS = {
  EXPLAIN: 'askbro-explain',
  TRANSLATE: 'askbro-translate',
  REPLY: 'askbro-reply',
} as const;

export type ContextMenuActionId = (typeof CONTEXT_MENU_IDS)[keyof typeof CONTEXT_MENU_IDS];

export const MENU_ACTION_MAP: Record<string, ContextActionType> = {
  [CONTEXT_MENU_IDS.EXPLAIN]: 'explain',
  [CONTEXT_MENU_IDS.TRANSLATE]: 'translate',
  [CONTEXT_MENU_IDS.REPLY]: 'reply',
};

export const MENU_CONFIGS = [
  {
    id: CONTEXT_MENU_IDS.EXPLAIN,
    title: 'Explain this with ASKbro',
    contexts: ['selection'] as chrome.contextMenus.ContextType[],
  },
  {
    id: CONTEXT_MENU_IDS.TRANSLATE,
    title: 'Translate to Hindi/Hinglish',
    contexts: ['selection'] as chrome.contextMenus.ContextType[],
  },
  {
    id: CONTEXT_MENU_IDS.REPLY,
    title: 'Draft a reply to this',
    contexts: ['selection'] as chrome.contextMenus.ContextType[],
  },
];

export const STORAGE_KEY_PENDING_ACTION = 'askbro_pending_context_action';

let isSettingUpMenus = false;

/**
 * Register right-click context menu items
 */
export function setupContextMenus(): void {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) {
    return;
  }

  if (isSettingUpMenus) {
    return;
  }
  isSettingUpMenus = true;

  // Remove all existing ASKbro menus first to avoid duplicate ID errors
  chrome.contextMenus.removeAll(() => {
    isSettingUpMenus = false;

    if (chrome.runtime?.lastError) {
      console.debug('[ASKbro Context Menu] Notice during removeAll:', chrome.runtime.lastError.message);
    }

    MENU_CONFIGS.forEach((config) => {
      chrome.contextMenus.create(
        {
          id: config.id,
          title: config.title,
          contexts: config.contexts,
        },
        () => {
          // Inspect chrome.runtime.lastError to safely handle any race or duplicate IDs
          if (chrome.runtime?.lastError) {
            console.debug(`[ASKbro Context Menu] Notice creating menu ${config.id}:`, chrome.runtime.lastError.message);
          }
        }
      );
    });
    console.log('[ASKbro Context Menu] Registered right-click actions (Explain, Translate, Reply).');
  });
}

/**
 * Persists pending context action so the side panel can pick it up on mount
 */
export async function setPendingContextAction(action: ContextMenuActionPayload): Promise<void> {
  await setLocalStorage(STORAGE_KEY_PENDING_ACTION, action);
}

/**
 * Reads pending context action (discards if older than 5 minutes)
 */
export async function getPendingContextAction(): Promise<ContextMenuActionPayload | null> {
  const action = await getLocalStorage<ContextMenuActionPayload | null>(STORAGE_KEY_PENDING_ACTION, null);
  if (!action) {
    return null;
  }

  // Stale check (5 mins max)
  if (Date.now() - action.timestamp > 5 * 60 * 1000) {
    await clearPendingContextAction();
    return null;
  }

  return action;
}

/**
 * Clears pending context action once consumed
 */
export async function clearPendingContextAction(): Promise<void> {
  await removeLocalStorage(STORAGE_KEY_PENDING_ACTION);
}

/**
 * Handles context menu clicks from user
 */
export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<ContextMenuActionPayload | null> {
  const action = MENU_ACTION_MAP[info.menuItemId as string];
  if (!action) {
    return null;
  }

  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) {
    console.warn('[ASKbro Context Menu] Clicked without selected text.');
    return null;
  }

  const payload: ContextMenuActionPayload = {
    id: `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    action,
    selectedText,
    pageTitle: tab?.title,
    pageUrl: tab?.url || info.pageUrl,
    tabId: tab?.id,
    timestamp: Date.now(),
  };

  // 1. Stage in storage for cold-start pickup by Side Panel
  await setPendingContextAction(payload);

  // 2. Open Chrome Side Panel on user gesture
  if (tab?.id && chrome.sidePanel && 'open' in chrome.sidePanel) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
      console.warn('[ASKbro Context Menu] Could not open side panel for tab:', tab.id, err);
      if (tab.windowId && 'open' in chrome.sidePanel) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch (winErr) {
          console.warn('[ASKbro Context Menu] Could not open side panel for window:', tab.windowId, winErr);
        }
      }
    }
  }

  // 3. Broadcast runtime message in case Side Panel is already open & listening
  try {
    const msg: ContextMenuActionMessage = {
      type: 'CONTEXT_MENU_ACTION',
      payload,
    };
    chrome.runtime.sendMessage(msg).catch(() => {
      // Catch expected error if no side panel receiver exists yet
    });
  } catch {
    // Ignore runtime message error if no listener
  }

  return payload;
}

/**
 * Initialize all context menu lifecycle listeners
 */
export function initContextMenuHandlers(): void {
  if (typeof chrome === 'undefined') return;

  // Re-create context menus on extension installation / update
  if (chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener((details) => {
      console.log('[ASKbro Context Menu] Extension onInstalled triggered:', details.reason);
      setupContextMenus();
    });
  }

  // Handle right-click clicks
  if (chrome.contextMenus?.onClicked) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      handleContextMenuClick(info, tab).catch((err) => {
        console.error('[ASKbro Context Menu] Error handling context menu click:', err);
      });
    });
  }

  // Also setup context menus right now if running in service worker startup
  setupContextMenus();
}

