/**
 * ASKbro Action Map & "Find It For Me" Engine (Slice 3.2)
 *
 * Implements:
 * - Converts raw DOM ActionableElement[] into clean, compact representation:
 *   {"id": 4, "type": "button", "text": "Submit Application"}
 * - "Find It For Me" Element Locator: Matches user natural language requests
 *   (e.g., "Where do I upload my resume?", "Find the login button") to target element ID
 * - Gemini Flash-Lite / Flash LLM integration with Groq Cloud fallback via resilient execution
 * - Zod schema validation for structured locator output:
 *   {"targetElementId": 4, "reason": "File upload input", "confidence": "high"}
 * - Smoothly scrolls to target and pulses cyan highlight on badge #id without clicking
 * - English and Hinglish language support
 * - Intent detection for natural locator prompts in chat
 */

import {
  ActionableElement,
  CompactActionElement,
  ActionStep,
  FindElementResult,
  FindElementResultSchema,
} from '../../types/action';
import { OutputLanguage } from '../../types/ai';
import {
  ScanElementsMessage,
  ScanElementsResponse,
  DryRunHighlightMessage,
  DryRunHighlightResponse,
  RemoveBadgesMessage,
  RemoveBadgesResponse,
  ExecuteActionMessage,
  ExecuteActionResponse,
} from '../../types/messages';
import { executeResilientContent } from './rateLimiter';
import { getActiveTab, isRestrictedUrl } from '../reader/tabReader';

/** Maximum number of elements to include in LLM action map to preserve context tokens */
export const MAX_ACTION_MAP_ELEMENTS = 150;

/** Default highlight glow duration in milliseconds */
export const DEFAULT_HIGHLIGHT_DURATION_MS = 3000;

// ---------------------------------------------------------------------------
// 1. Compact Action Map Generation
// ---------------------------------------------------------------------------

/**
 * Converts a raw DOM ActionableElement into a clean, compact representation.
 * Strips verbose bounding rects and unneeded attributes while preserving essential
 * semantic cues (id, type, text, placeholder, aria-label, name, value).
 *
 * Example output:
 * {"id": 4, "type": "button", "text": "Submit Application"}
 * {"id": 7, "type": "file input", "text": "Upload Resume", "name": "resume"}
 */
export function toCompactActionElement(el: ActionableElement): CompactActionElement {
  let type = el.tag;

  if (el.tag === 'input') {
    const rawType = el.type?.toLowerCase();
    if (rawType === 'file') {
      type = 'file input';
    } else if (rawType === 'submit' || rawType === 'button') {
      type = 'button';
    } else if (rawType === 'search') {
      type = 'search input';
    } else if (rawType === 'checkbox') {
      type = 'checkbox';
    } else if (rawType === 'radio') {
      type = 'radio';
    } else if (rawType) {
      type = `input[${rawType}]`;
    } else {
      type = 'input';
    }
  } else if (el.tag === 'a') {
    type = 'link';
  } else if (el.tag === 'button') {
    type = 'button';
  } else if (el.tag === 'select') {
    type = 'dropdown/select';
  } else if (el.tag === 'textarea') {
    type = 'textarea';
  } else if (el.role) {
    const roleLower = el.role.toLowerCase();
    if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'combobox', 'searchbox'].includes(roleLower)) {
      type = roleLower;
    }
  }

  const compact: CompactActionElement = {
    id: el.id,
    type,
  };

  const cleanText = el.text?.trim();
  if (cleanText) {
    compact.text = cleanText;
  }

  const cleanPlaceholder = el.placeholder?.trim();
  if (cleanPlaceholder && cleanPlaceholder !== cleanText) {
    compact.placeholder = cleanPlaceholder;
  }

  const cleanAria = el.ariaLabel?.trim();
  if (cleanAria && cleanAria !== cleanText && cleanAria !== cleanPlaceholder) {
    compact.ariaLabel = cleanAria;
  }

  const cleanName = el.name?.trim();
  if (cleanName && cleanName !== cleanText) {
    compact.name = cleanName;
  }

  if (el.role && el.role !== type) {
    compact.role = el.role;
  }

  if (el.value && !cleanText && type !== 'file input') {
    compact.value = el.value.trim();
  }

  if (el.href && type === 'link') {
    try {
      const url = new URL(el.href);
      compact.href = url.pathname + (url.search ? url.search.substring(0, 30) : '');
    } catch {
      compact.href = el.href.substring(0, 60);
    }
  }

  return compact;
}

/**
 * Transforms an array of ActionableElement items into an array of compact items
 */
export function generateCompactActionMap(
  elements: ActionableElement[],
  maxElements: number = MAX_ACTION_MAP_ELEMENTS
): CompactActionElement[] {
  if (!elements || !Array.isArray(elements)) {
    return [];
  }
  return elements.slice(0, maxElements).map(toCompactActionElement);
}

/**
 * Formats actionable elements into pretty-printed or compact JSON string
 */
export function formatActionMapJson(
  elements: (ActionableElement | CompactActionElement)[],
  maxElements: number = MAX_ACTION_MAP_ELEMENTS
): string {
  if (!elements || !Array.isArray(elements) || elements.length === 0) {
    return '[]';
  }

  const isRaw = 'rect' in elements[0];
  const compact = isRaw
    ? generateCompactActionMap(elements as ActionableElement[], maxElements)
    : (elements as CompactActionElement[]).slice(0, maxElements);

  return JSON.stringify(compact, null, 2);
}

// ---------------------------------------------------------------------------
// 2. Prompt Building & Injection Containment
// ---------------------------------------------------------------------------

/**
 * Builds the system instruction for element localization (English & Hinglish)
 */
export function buildFindElementSystemInstruction(language: OutputLanguage = 'en'): string {
  const isHinglish = language === 'hinglish';

  if (isHinglish) {
    return `You are ASKbro's Element Locator engine (Slice 3.2).
Your task is to analyze the user's natural language request and identify the single most relevant interactive element ID from the webpage JSON Action Map.

Rules:
1. Return ONLY a single raw JSON object matching this exact schema:
{
  "targetElementId": number | null,
  "reason": string,
  "confidence": "high" | "medium" | "low"
}
2. "targetElementId" must be the exact integer ID from the action map, or null if no appropriate element exists.
3. Write the "reason" in natural Roman-script Hinglish (e.g., "Resume upload karne ke liye file input box", "Search button header me").
4. Never make up an element ID that is not present in the action map.
5. If the request cannot be satisfied by any element on the page, set targetElementId to null and explain why.
6. Do NOT include markdown code fences (\`\`\`json) or any conversational text. Return ONLY the JSON object.`;
  }

  return `You are ASKbro's Element Locator engine (Slice 3.2).
Your task is to analyze the user's natural language request and identify the single most relevant interactive element ID from the webpage JSON Action Map.

Rules:
1. Return ONLY a single raw JSON object matching this exact schema:
{
  "targetElementId": number | null,
  "reason": string,
  "confidence": "high" | "medium" | "low"
}
2. "targetElementId" must be the exact integer ID from the action map, or null if no appropriate element exists.
3. "reason" must be a concise, one-sentence description explaining why this element was chosen (e.g., "File upload input for submitting resume", "Search input field in main navigation").
4. Never make up an element ID that is not present in the action map.
5. If the user request cannot be satisfied by any element on the page, set targetElementId to null and explain in reason.
6. Do NOT include markdown code fences (\`\`\`json) or any conversational text. Return ONLY the JSON object.`;
}

/**
 * Builds user prompt containing sanitized action map JSON and user request
 */
export function buildFindElementUserPrompt(
  query: string,
  actionMapJson: string,
  pageMeta?: { title?: string; url?: string }
): string {
  const title = pageMeta?.title ? pageMeta.title.replace(/[<>]/g, '') : 'Webpage';
  const url = pageMeta?.url ? pageMeta.url.replace(/[<>]/g, '') : 'Current Page';

  // Sanitize tags to prevent prompt injection breakouts
  const sanitizedActionMap = actionMapJson
    .replace(/<\/action_map>/gi, '&lt;/action_map&gt;')
    .trim();

  const sanitizedQuery = query
    .replace(/<\/user_request>/gi, '&lt;/user_request&gt;')
    .trim();

  return `Context:
Page Title: ${title}
Page URL: ${url}

<action_map>
${sanitizedActionMap}
</action_map>

<user_request>
${sanitizedQuery}
</user_request>

Find the target element ID that best fulfills the user's request. Return ONLY the JSON response.`;
}

// ---------------------------------------------------------------------------
// 3. Response Parsing & Validation
// ---------------------------------------------------------------------------

/**
 * Parses and validates LLM response text into structured FindElementResult
 */
export function parseFindElementResponse(rawText: string): FindElementResult {
  if (!rawText || !rawText.trim()) {
    return {
      targetElementId: null,
      reason: 'No response received from model',
      confidence: 'low',
    };
  }

  let cleaned = rawText.trim();

  // Strip markdown code fences if model wrapped them
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Find first '{' and last '}'
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const jsonCandidate = cleaned.substring(startIdx, endIdx + 1);
    try {
      const parsed = JSON.parse(jsonCandidate);
      const validated = FindElementResultSchema.safeParse({
        targetElementId: parsed.targetElementId !== undefined ? parsed.targetElementId : parsed.targetId ?? null,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'Located element',
        confidence: parsed.confidence,
      });

      if (validated.success) {
        return validated.data;
      }
    } catch {
      // JSON parse failed, try regex fallback below
    }
  }

  // Regex fallback extraction
  const idMatch = cleaned.match(/"targetElementId"\s*:\s*(\d+|null)/i) ||
                 cleaned.match(/"targetId"\s*:\s*(\d+|null)/i);
  const reasonMatch = cleaned.match(/"reason"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
  const confidenceMatch = cleaned.match(/"confidence"\s*:\s*"(high|medium|low)"/i);

  if (idMatch || reasonMatch) {
    const targetElementId = idMatch && idMatch[1] !== 'null' ? parseInt(idMatch[1], 10) : null;
    const reason = reasonMatch ? reasonMatch[1].replace(/\\"/g, '"') : 'Matching element identified';
    const confidence = (confidenceMatch ? confidenceMatch[1].toLowerCase() : 'medium') as 'high' | 'medium' | 'low';

    return {
      targetElementId,
      reason,
      confidence,
    };
  }

  return {
    targetElementId: null,
    reason: 'Could not identify target element on page',
    confidence: 'low',
  };
}

// ---------------------------------------------------------------------------
// 4. Intent Detection Helper
// ---------------------------------------------------------------------------

/**
 * Detects whether a natural language query is an Element Locator ("Find It For Me") request.
 * Supports natural English and Hinglish patterns.
 */
export function isFindElementIntent(query: string): boolean {
  if (!query || typeof query !== 'string') return false;

  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 3) return false;

  // Explicit locator prefix triggers
  if (
    trimmed.startsWith('find:') ||
    trimmed.startsWith('locate:') ||
    trimmed.startsWith('find it:') ||
    trimmed.startsWith('find it for me:') ||
    trimmed.startsWith('/find') ||
    trimmed.startsWith('/locate')
  ) {
    return true;
  }

  // English natural question patterns
  const englishPatterns = [
    /\bwhere\s+(?:do\s+i|can\s+i|is|are|to)\b/i,
    /\bwhere\s+should\s+i\b/i,
    /\bhow\s+do\s+i\s+(?:find|upload|click|submit|login|sign\s*in)\b/i,
    /\b(?:find|locate|spotlight|highlight)\s+(?:the|a|an|my|this|that|all)\b/i,
    /\bshow\s+(?:me\s+)?where\b/i,
    /\bpoint\s+(?:me\s+)?to\b/i,
    /\bwhich\s+(?:button|input|field|link|option|box)\b/i,
    /\bfind\s+(?:login|signup|sign\s*in|submit|upload|search|cart|checkout|resume|apply|settings|download)\b/i,
    /\bwhere['’]?s\b/i,
  ];

  for (const pattern of englishPatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Hinglish patterns
  const hinglishPatterns = [
    /\bkahan\s+(?:hai|pe\s+hai|milega|par\s+hai)\b/i,
    /\b(?:kahan|kidhar)\s+(?:upload|click|submit|login|search)\b/i,
    /\b(?:resume|cv|file)\s+kahan\b/i,
    /\b(?:button|input|link)\s+kahan\b/i,
    /\b(?:dhoondho|dhoondo|locate\s+karo|find\s+karo)\b/i,
    /\bkidhar\s+hai\b/i,
  ];

  for (const pattern of hinglishPatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 5. Core AI Locator Service
// ---------------------------------------------------------------------------

export interface FindTargetElementOptions {
  query: string;
  actionMap: ActionableElement[] | CompactActionElement[] | string;
  pageTitle?: string;
  pageUrl?: string;
  language?: OutputLanguage;
  apiKey?: string;
  groqApiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Evaluates an Action Map and user query with Gemini Flash-Lite (with Groq fallback)
 * to identify the target element ID.
 */
export async function findTargetElement(
  options: FindTargetElementOptions
): Promise<FindElementResult> {
  const { query, actionMap, pageTitle, pageUrl, language = 'en', signal } = options;

  let actionMapJson = '';
  let elementsCount = 0;

  if (typeof actionMap === 'string') {
    actionMapJson = actionMap.trim();
    try {
      const parsed = JSON.parse(actionMapJson);
      elementsCount = Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      elementsCount = 1;
    }
  } else if (Array.isArray(actionMap)) {
    elementsCount = actionMap.length;
    actionMapJson = formatActionMapJson(actionMap);
  }

  // Short-circuit if action map is empty
  if (elementsCount === 0 || actionMapJson === '[]' || !actionMapJson) {
    return {
      targetElementId: null,
      reason: language === 'hinglish'
        ? 'Current page par koi interactive elements nahi mile.'
        : 'No interactive elements detected on the current page.',
      confidence: 'low',
    };
  }

  const systemInstruction = buildFindElementSystemInstruction(language);
  const userPrompt = buildFindElementUserPrompt(query, actionMapJson, {
    title: pageTitle,
    url: pageUrl,
  });

  // Call resilient execution with low temperature (0.1) for deterministic element matching
  const result = await executeResilientContent(
    [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    {
      systemInstruction,
      model: options.model,
      apiKey: options.apiKey,
      groqApiKey: options.groqApiKey,
      temperature: 0.1,
      maxOutputTokens: 256,
      signal,
    }
  );

  const parsed = parseFindElementResponse(result.text);

  // If the parsed ID is not present in the provided action map (when array provided), invalidate it
  if (parsed.targetElementId !== null && Array.isArray(actionMap)) {
    const exists = actionMap.some((el) => el.id === parsed.targetElementId);
    if (!exists) {
      return {
        targetElementId: null,
        reason: `Model suggested element #${parsed.targetElementId}, but it does not exist in the active action map.`,
        confidence: 'low',
      };
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// 6. Tab Content Script Bridge Helpers
// ---------------------------------------------------------------------------

/**
 * Scans the active tab's DOM for interactive elements and displays numbered badges
 */
export async function scanTabActionMap(
  tabId?: number,
  showBadges: boolean = true
): Promise<{ elements: ActionableElement[]; count: number }> {
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
    if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(targetTabId);
        targetTabUrl = tab?.url || '';
      } catch {
        // ignore
      }
    }
    if (!targetTabUrl) {
      const activeTab = await getActiveTab();
      if (activeTab && activeTab.id === targetTabId) {
        targetTabUrl = activeTab.url || '';
      }
    }
  }

  if (targetTabUrl && isRestrictedUrl(targetTabUrl)) {
    throw new Error(
      'Browser security restricts extensions from scanning internal pages (such as chrome:// or empty tabs). Please focus a standard web page.'
    );
  }

  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return { elements: [], count: 0 };
  }

  const msg: ScanElementsMessage = {
    type: 'SCAN_ELEMENTS',
    showBadges,
  };

  try {
    const response = (await chrome.tabs.sendMessage(targetTabId, msg)) as ScanElementsResponse;
    if (response && response.success) {
      return {
        elements: response.elements || [],
        count: response.count || (response.elements ? response.elements.length : 0),
      };
    }
    throw new Error(response?.error || 'Failed to scan elements on active tab.');
  } catch (error: any) {
    // If content script was not injected, attempt injection and retry once
    if (chrome.scripting) {
      try {
        const manifest = chrome.runtime.getManifest();
        const contentScripts = manifest.content_scripts?.[0]?.js;
        if (contentScripts && contentScripts.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            files: contentScripts,
          });
          await new Promise((resolve) => setTimeout(resolve, 80));
          const retryRes = (await chrome.tabs.sendMessage(targetTabId, msg)) as ScanElementsResponse;
          if (retryRes && retryRes.success) {
            return {
              elements: retryRes.elements || [],
              count: retryRes.count || (retryRes.elements ? retryRes.elements.length : 0),
            };
          }
        }
      } catch (injectionErr) {
        console.warn('[ASKbro ActionMap] Script reinjection failed:', injectionErr);
      }
    }

    throw new Error(error?.message || 'Could not communicate with tab content scanner.');
  }
}

/**
 * Highlights a target badge pill and outlines the element with a glowing cyan box on the active page.
 * Smoothly scrolls the element into view without clicking.
 */
export async function highlightTabElement(
  targetElementId: number,
  tabId?: number,
  durationMs: number = DEFAULT_HIGHLIGHT_DURATION_MS
): Promise<boolean> {
  let targetTabId = tabId;

  if (!targetTabId) {
    const activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) return false;
    targetTabId = activeTab.id;
  }

  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return false;
  }

  const msg: DryRunHighlightMessage = {
    type: 'DRY_RUN_HIGHLIGHT',
    targetElementId,
    durationMs,
  };

  try {
    const response = (await chrome.tabs.sendMessage(targetTabId, msg)) as DryRunHighlightResponse;
    return Boolean(response && response.success && response.found);
  } catch (err) {
    console.warn('[ASKbro ActionMap] Error sending DRY_RUN_HIGHLIGHT:', err);
    return false;
  }
}

/**
 * Removes all active badges and overlays from the active tab
 */
export async function clearTabBadges(tabId?: number): Promise<boolean> {
  let targetTabId = tabId;

  if (!targetTabId) {
    const activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) return false;
    targetTabId = activeTab.id;
  }

  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return false;
  }

  const msg: RemoveBadgesMessage = {
    type: 'REMOVE_BADGES',
  };

  try {
    const response = (await chrome.tabs.sendMessage(targetTabId, msg)) as RemoveBadgesResponse;
    return Boolean(response && response.success);
  } catch {
    return false;
  }
}

/**
 * Dispatches an approved ActionStep to the active content script for execution.
 * STRICT HITL: Browser actions are dispatched ONLY after explicit user approval.
 */
export async function executeTabAction(
  step: ActionStep,
  tabId?: number
): Promise<ExecuteActionResponse> {
  let targetTabId = tabId;

  if (!targetTabId) {
    const activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) {
      return {
        success: false,
        executed: false,
        error: 'No active browser tab found for action execution.',
      };
    }
    targetTabId = activeTab.id;
  }

  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) {
    return {
      success: false,
      executed: false,
      error: 'chrome.tabs API is not available.',
    };
  }

  const msg: ExecuteActionMessage = {
    type: 'EXECUTE_ACTION',
    step,
  };

  try {
    const response = (await chrome.tabs.sendMessage(targetTabId, msg)) as ExecuteActionResponse;
    if (response) {
      return response;
    }
    return {
      success: true,
      executed: true,
    };
  } catch (err: any) {
    console.warn('[ASKbro ActionMap] Error dispatching EXECUTE_ACTION:', err);
    return {
      success: false,
      executed: false,
      error: err?.message || 'Content script did not respond to action execution.',
    };
  }
}

// ---------------------------------------------------------------------------
// 7. Full "Find It For Me" Orchestration
// ---------------------------------------------------------------------------

export interface LocateAndHighlightOptions {
  query: string;
  tabId?: number;
  pageTitle?: string;
  pageUrl?: string;
  language?: OutputLanguage;
  durationMs?: number;
  elements?: ActionableElement[];
  apiKey?: string;
  groqApiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface LocateAndHighlightResult {
  success: boolean;
  found: boolean;
  targetElementId: number | null;
  reason: string;
  highlighted: boolean;
  confidence?: 'high' | 'medium' | 'low';
  element?: ActionableElement;
  error?: string;
}

/**
 * End-to-end "Find It For Me" workflow:
 * 1. Scans interactive elements & renders numbered badges on the page (Slice 3.1)
 * 2. Generates compact JSON Action Map (Slice 3.2)
 * 3. Sends prompt to Gemini Flash-Lite with structured output
 * 4. If target found: smoothly scrolls page and pulses cyan highlight on badge without clicking
 * 5. Returns structured status to the caller
 */
export async function locateAndHighlightElement(
  options: LocateAndHighlightOptions
): Promise<LocateAndHighlightResult> {
  try {
    const { query, tabId, durationMs = DEFAULT_HIGHLIGHT_DURATION_MS } = options;

    // 1. Get or scan actionable elements
    let elements = options.elements;
    if (!elements || elements.length === 0) {
      const scanResult = await scanTabActionMap(tabId, true);
      elements = scanResult.elements;
    }

    if (!elements || elements.length === 0) {
      return {
        success: true,
        found: false,
        targetElementId: null,
        reason: options.language === 'hinglish'
          ? 'Is page par koi interactive elements nahi mile.'
          : 'No interactive elements detected on the page.',
        highlighted: false,
        confidence: 'low',
      };
    }

    // 2. Identify target element using Gemini Flash-Lite with resilient fallback
    const findResult = await findTargetElement({
      query,
      actionMap: elements,
      pageTitle: options.pageTitle,
      pageUrl: options.pageUrl,
      language: options.language,
      apiKey: options.apiKey,
      groqApiKey: options.groqApiKey,
      model: options.model,
      signal: options.signal,
    });

    // 3. If target was located, highlight it on the page
    if (findResult.targetElementId !== null) {
      const highlighted = await highlightTabElement(
        findResult.targetElementId,
        tabId,
        durationMs
      );

      const matchedElement = elements.find((el) => el.id === findResult.targetElementId);

      return {
        success: true,
        found: true,
        targetElementId: findResult.targetElementId,
        reason: findResult.reason,
        confidence: findResult.confidence,
        highlighted,
        element: matchedElement,
      };
    }

    return {
      success: true,
      found: false,
      targetElementId: null,
      reason: findResult.reason,
      confidence: findResult.confidence,
      highlighted: false,
    };
  } catch (err: any) {
    return {
      success: false,
      found: false,
      targetElementId: null,
      reason: err?.message || 'Error occurred while locating element.',
      highlighted: false,
      error: err?.message || String(err),
    };
  }
}
