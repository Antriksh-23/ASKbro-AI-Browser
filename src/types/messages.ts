/**
 * Strongly typed chrome.runtime and chrome.tabs message definitions
 */

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
  | 'CAPTURE_SCREENSHOT';

export interface BaseMessage {
  type: MessageType;
}

export interface PingMessage extends BaseMessage {
  type: 'PING' | 'CONTENT_PING';
}

export interface ExtractPageContentMessage extends BaseMessage {
  type: 'EXTRACT_PAGE_CONTENT';
}

export interface PageContentResponse {
  title: string;
  url: string;
  textContent: string;
  excerpt?: string;
  byline?: string;
  length?: number;
  isYouTube?: boolean;
  videoDetails?: {
    videoId: string;
    title: string;
    channel: string;
    description: string;
    chapters: Array<{ time: number; title: string }>;
  };
}
