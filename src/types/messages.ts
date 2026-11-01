/**
 * Strongly typed chrome.runtime and chrome.tabs message definitions
 */

import type { ChatMessage, OutputLanguage } from './ai';
import type {
  ActionableElement,
  ActionStep,
  AgentTaskSession,
  ActionAuditLogEntry,
  ActionHistoryEntry,
} from './action';

export type MessageType =
  | 'PING'
  | 'CONTENT_PING'
  | 'EXTRACT_PAGE_CONTENT'
  | 'EXTRACT_PAGE_CONTENT_RESPONSE'
  | 'SCAN_ELEMENTS'
  | 'SCAN_ELEMENTS_RESPONSE'
  | 'EXECUTE_ACTION'
  | 'EXECUTE_ACTION_RESPONSE'
  | 'DRY_RUN_HIGHLIGHT'
  | 'REMOVE_BADGES'
  | 'CAPTURE_SCREENSHOT'
  | 'CAPTURE_SCREENSHOT_RESPONSE'
  | 'SEEK_VIDEO'
  | 'SEEK_VIDEO_RESPONSE'
  | 'CONTEXT_MENU_ACTION'
  | 'GET_PENDING_CONTEXT_ACTION'
  | 'CLEAR_PENDING_CONTEXT_ACTION'
  | 'EXPLAIN_HIGHLIGHTED_TEXT'
  | 'GET_SELECTED_TEXT'
  | 'GET_SELECTED_TEXT_RESPONSE'
  | 'QUERY_PAGE_CHAT'
  | 'QUERY_PAGE_CHAT_RESPONSE'
  | 'FIND_ELEMENT_ON_PAGE'
  | 'FIND_ELEMENT_ON_PAGE_RESPONSE'
  | 'GET_AGENT_SESSION'
  | 'SAVE_AGENT_SESSION'
  | 'CLEAR_AGENT_SESSION'
  | 'RECORD_AUDIT_LOG'
  | 'GET_AUDIT_LOG'
  | 'CLEAR_AUDIT_LOG'
  | 'AGENT_HEARTBEAT'
  | 'CHECK_WORKER_WAKEUP';

export interface BaseMessage {
  type: MessageType;
}

export interface PingMessage extends BaseMessage {
  type: 'PING' | 'CONTENT_PING';
}

export interface ExtractPageContentOptions {
  /** If true, bypasses Readability and tests DOM fallback extraction */
  forceFallback?: boolean;
  /** Maximum character limit for text content if truncating */
  maxLength?: number;
}

export interface ExtractPageContentMessage extends BaseMessage {
  type: 'EXTRACT_PAGE_CONTENT';
  options?: ExtractPageContentOptions;
}

export interface YouTubeVideoChapter {
  time: number; // in seconds
  timestampStr: string; // e.g. "01:23"
  title: string;
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  channel: string;
  channelUrl?: string;
  description: string;
  chapters: YouTubeVideoChapter[];
  durationSeconds?: number;
  durationFormatted?: string;
  currentTimeSeconds?: number;
  isLive?: boolean;
  isShorts?: boolean;
  transcript?: string;
  transcriptSource?: 'captions' | 'panel' | 'description';
  transcriptSegmentsCount?: number;
}

export interface SeekVideoMessage extends BaseMessage {
  type: 'SEEK_VIDEO';
  seconds: number;
}

export interface SeekVideoResponse {
  success: boolean;
  currentTime?: number;
  error?: string;
}

export interface PageContentResponse {
  success: boolean;
  title: string;
  url: string;
  textContent: string;
  excerpt?: string;
  byline?: string;
  author?: string;
  siteName?: string;
  length: number;
  wordCount: number;
  readingTimeMinutes: number;
  extractedWith: 'readability' | 'fallback' | 'youtube';
  timestamp: number;
  isYouTube?: boolean;
  videoDetails?: YouTubeVideoDetails;
  error?: string;
}

export interface ExtractPageContentResponseMessage extends BaseMessage {
  type: 'EXTRACT_PAGE_CONTENT_RESPONSE';
  payload: PageContentResponse;
}

// ---------------------------------------------------------------------------
// Slice 2.2: Context Menu AI Actions Types
// ---------------------------------------------------------------------------

export type ContextActionType = 'explain' | 'translate' | 'reply';

export interface ContextMenuActionPayload {
  id: string;
  action: ContextActionType;
  selectedText: string;
  pageTitle?: string;
  pageUrl?: string;
  tabId?: number;
  timestamp: number;
}

export interface ContextMenuActionMessage extends BaseMessage {
  type: 'CONTEXT_MENU_ACTION';
  payload: ContextMenuActionPayload;
}

export interface GetPendingContextActionMessage extends BaseMessage {
  type: 'GET_PENDING_CONTEXT_ACTION';
}

export interface ClearPendingContextActionMessage extends BaseMessage {
  type: 'CLEAR_PENDING_CONTEXT_ACTION';
}

export interface ExplainHighlightedTextMessage extends BaseMessage {
  type: 'EXPLAIN_HIGHLIGHTED_TEXT';
  payload: {
    selectedText: string;
    pageTitle?: string;
    pageUrl?: string;
  };
}

export interface GetSelectedTextMessage extends BaseMessage {
  type: 'GET_SELECTED_TEXT';
}

export interface GetSelectedTextResponse {
  success: boolean;
  selectedText: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Slice 2.1: Grounded Page Chat Messages
// ---------------------------------------------------------------------------

export interface QueryPageChatMessage extends BaseMessage {
  type: 'QUERY_PAGE_CHAT';
  query: string;
  pageContext?: string;
  pageTitle?: string;
  pageUrl?: string;
  history?: ChatMessage[];
  language?: OutputLanguage;
}

export interface QueryPageChatResponse {
  success: boolean;
  answer?: string;
  isNotFoundOnPage?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Slice 2.3: Visual Screen Understanding Messages
// ---------------------------------------------------------------------------

export interface CaptureScreenshotMessage extends BaseMessage {
  type: 'CAPTURE_SCREENSHOT';
  windowId?: number | null;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface CaptureScreenshotResponse {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface CaptureScreenshotResponseMessage extends BaseMessage {
  type: 'CAPTURE_SCREENSHOT_RESPONSE';
  payload: CaptureScreenshotResponse;
}

// ---------------------------------------------------------------------------
// Phase 3 / Slice 3.1: DOM Scanning & Badge Overlay Messages
// ---------------------------------------------------------------------------

export interface ScanElementsMessage extends BaseMessage {
  type: 'SCAN_ELEMENTS';
  showBadges?: boolean;
}

export interface ScanElementsResponse {
  success: boolean;
  elements: ActionableElement[];
  count: number;
  error?: string;
}

export interface ScanElementsResponseMessage extends BaseMessage {
  type: 'SCAN_ELEMENTS_RESPONSE';
  payload: ScanElementsResponse;
}

export interface RemoveBadgesMessage extends BaseMessage {
  type: 'REMOVE_BADGES';
}

export interface RemoveBadgesResponse {
  success: boolean;
  error?: string;
}

export interface DryRunHighlightMessage extends BaseMessage {
  type: 'DRY_RUN_HIGHLIGHT';
  targetElementId: number;
  durationMs?: number;
}

export interface DryRunHighlightResponse {
  success: boolean;
  found: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Slice 3.2: Action Map & "Find It For Me" Messages
// ---------------------------------------------------------------------------

export interface FindElementMessage extends BaseMessage {
  type: 'FIND_ELEMENT_ON_PAGE';
  query: string;
  tabId?: number;
  language?: OutputLanguage;
}

export interface FindElementResponse {
  success: boolean;
  found: boolean;
  targetElementId: number | null;
  reason: string;
  highlighted: boolean;
  element?: ActionableElement;
  error?: string;
}

export interface ExecuteActionMessage extends BaseMessage {
  type: 'EXECUTE_ACTION';
  step: ActionStep;
}

export interface ExecuteActionResponse {
  success: boolean;
  executed: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Slice 3.6: Worker Hibernation & Session State Persistence Messages
// ---------------------------------------------------------------------------

export interface GetAgentSessionMessage extends BaseMessage {
  type: 'GET_AGENT_SESSION';
}

export interface GetAgentSessionResponse {
  success: boolean;
  session: AgentTaskSession | null;
  error?: string;
}

export interface SaveAgentSessionMessage extends BaseMessage {
  type: 'SAVE_AGENT_SESSION';
  session: AgentTaskSession;
}

export interface SaveAgentSessionResponse {
  success: boolean;
  error?: string;
}

export interface ClearAgentSessionMessage extends BaseMessage {
  type: 'CLEAR_AGENT_SESSION';
}

export interface ClearAgentSessionResponse {
  success: boolean;
  error?: string;
}

export interface RecordAuditLogMessage extends BaseMessage {
  type: 'RECORD_AUDIT_LOG';
  entry: ActionHistoryEntry;
  context?: {
    taskId?: string;
    goal?: string;
    tabId?: number;
    tabUrl?: string;
    tabTitle?: string;
  };
}

export interface RecordAuditLogResponse {
  success: boolean;
  auditEntry?: ActionAuditLogEntry;
  error?: string;
}

export interface GetAuditLogMessage extends BaseMessage {
  type: 'GET_AUDIT_LOG';
  options?: {
    taskId?: string;
    limit?: number;
    status?: string;
    reverse?: boolean;
  };
}

export interface GetAuditLogResponse {
  success: boolean;
  entries: ActionAuditLogEntry[];
  error?: string;
}

export interface ClearAuditLogMessage extends BaseMessage {
  type: 'CLEAR_AUDIT_LOG';
  taskId?: string;
}

export interface ClearAuditLogResponse {
  success: boolean;
  error?: string;
}

export interface AgentHeartbeatMessage extends BaseMessage {
  type: 'AGENT_HEARTBEAT';
  taskId?: string;
  timestamp?: number;
}

export interface AgentHeartbeatResponse {
  success: boolean;
  status: 'alive';
  timestamp: number;
}



