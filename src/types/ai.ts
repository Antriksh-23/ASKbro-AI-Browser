export type AIProvider = 'gemini' | 'groq';

export type OutputLanguage = 'en' | 'hinglish';

export type ReplyTone = 'professional' | 'direct' | 'casual';

export type ExplainStyle = 'detailed' | 'simple' | 'bullet';

export interface ContextMenuExecutionOptions {
  action: 'explain' | 'translate' | 'reply';
  selectedText: string;
  language?: OutputLanguage;
  replyTone?: ReplyTone;
  explainStyle?: ExplainStyle;
  model?: string;
  apiKey?: string;
  groqApiKey?: string;
  groqModel?: string;
  delays?: number[];
  maxRetries?: number;
  enableFallback?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onFallback?: (provider: AIProvider, reason: string) => void;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export interface AISettings {
  geminiApiKey: string;
  groqApiKey?: string;
  language: OutputLanguage;
  model: string;
}

export interface ConnectionTestResult {
  provider: AIProvider;
  success: boolean;
  message: string;
  latencyMs?: number;
  timestamp: number;
}

export interface YouTubeChapterItem {
  timestamp: string; // e.g. "02:15"
  seconds: number;   // e.g. 135
  title: string;     // e.g. "Introduction & Problem"
  note?: string;     // e.g. "Summary of the discussion"
}

/**
 * Standard structured summarization result
 * Enforces:
 * 1. TL;DR: Exactly one concise sentence
 * 2. 5 Key Takeaways: Bullet points with bold lead-ins
 * 3. Chapters / Key Moments (when video/chapters available): with clickable timestamps
 * 4. What to do next: 2-3 concrete actionable steps
 */
export interface SummaryResult {
  tldr: string;
  keyTakeaways: string[];
  actionableSteps: string[];
  chapters?: YouTubeChapterItem[];
}

export interface StructuredSummaryOutput {
  summary: SummaryResult;
  markdown: string;
  rawText: string;
  language: OutputLanguage;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GROQ_QWEN_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_GPT_120B_MODEL = 'openai/gpt-oss-120b';
export const GROQ_GPT_20B_MODEL = 'openai/gpt-oss-20b';
export const GROQ_MIXTRAL_MODEL = 'mixtral-8x7b-32768';
export const GROQ_LLAMA_70B_MODEL = 'llama-3.3-70b-versatile';
export const GROQ_LLAMA_8B_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';

export const SUPPORTED_GROQ_MODELS = [
  { id: GROQ_QWEN_MODEL, name: 'Qwen 3.8 27B (Groq - Ultra Fast & High Intelligence)', provider: 'groq' },
  { id: GROQ_GPT_120B_MODEL, name: 'GPT-OSS 120B (Groq - Deep Reasoning)', provider: 'groq' },
  { id: GROQ_GPT_20B_MODEL, name: 'GPT-OSS 20B (Groq - Instant Lightweight)', provider: 'groq' },
  { id: 'allam-2-7b', name: 'ALLaM 2 7B (Groq - Fast)', provider: 'groq' },
] as const;

export const SUPPORTED_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Recommended - Fast & Multimodal)', provider: 'gemini' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Balanced & Fast)', provider: 'gemini' },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite (Ultra Fast & Low Latency)', provider: 'gemini' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Balanced & Stable)', provider: 'gemini' },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B (Lightweight & High Speed)', provider: 'gemini' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Deep Analysis & Reasoning)', provider: 'gemini' },
] as const;

export const DEFAULT_SETTINGS: AISettings = {
  geminiApiKey: '',
  groqApiKey: '',
  language: 'en',
  model: DEFAULT_GEMINI_MODEL,
};

// ---------------------------------------------------------------------------
// Google Gemini REST API Types (v1beta)
// ---------------------------------------------------------------------------

export interface TextPart {
  text: string;
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string; // Base64 encoded
  };
}

export type GeminiPart = TextPart | InlineDataPart;

export type GeminiRole = 'user' | 'model' | 'system';

export interface GeminiContent {
  role?: GeminiRole;
  parts: GeminiPart[];
}

export interface GeminiSystemInstruction {
  parts: Array<{ text: string }>;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiSystemInstruction;
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
}

export interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
    role?: string;
  };
  finishReason?: string;
  index?: number;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  error?: {
    code: number;
    message: string;
    status?: string;
    details?: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Client Caller Options & Results
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  apiKey?: string;
  model?: string;
  systemInstruction?: string | GeminiSystemInstruction;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: 'text/plain' | 'application/json';
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  _isFallback?: boolean;
}

export type StreamChunkHandler = (chunkText: string, accumulatedText: string) => void;

export interface StreamOptions extends GenerateOptions {
  onChunk?: StreamChunkHandler;
}

export interface GenerateResult {
  text: string;
  finishReason?: string;
  usage?: GeminiUsageMetadata;
  rawResponse?: GeminiGenerateContentResponse;
  model?: string;
}

export interface SummarizeOptions {
  content: string;
  title?: string;
  url?: string;
  language?: OutputLanguage;
  model?: string;
  apiKey?: string;
  groqApiKey?: string;
  groqModel?: string;
  delays?: number[];
  maxRetries?: number;
  enableFallback?: boolean;
  signal?: AbortSignal;
  onChunk?: StreamChunkHandler;
  isYouTube?: boolean;
  onFallback?: (provider: AIProvider, reason: string) => void;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

// ---------------------------------------------------------------------------
// Slice 2.1: Grounded Page Chat Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  grounded?: boolean;
  isNotFoundOnPage?: boolean;
  provider?: AIProvider;
  usedFallback?: boolean;
  targetElementId?: number | null;
  isLocatorAction?: boolean;
}

export interface GroundedChatOptions {
  pageContext: string;
  pageTitle?: string;
  pageUrl?: string;
  history?: ChatMessage[];
  message: string;
  language?: OutputLanguage;
  model?: string;
  apiKey?: string;
  groqApiKey?: string;
  groqModel?: string;
  delays?: number[];
  maxRetries?: number;
  enableFallback?: boolean;
  signal?: AbortSignal;
  onChunk?: StreamChunkHandler;
  isYouTube?: boolean;
  onFallback?: (provider: AIProvider, reason: string) => void;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export interface GroundedChatResult {
  text: string;
  isNotFoundOnPage: boolean;
  model: string;
  finishReason?: string;
  provider?: AIProvider;
  usedFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Slice 2.3: Visual Screen Understanding Types
// ---------------------------------------------------------------------------

export const VISION_DEFAULT_MODEL = 'gemini-1.5-flash';

export type VisionPresetType =
  | 'chart'
  | 'table'
  | 'error'
  | 'ui'
  | 'general';

export interface VisionPresetPrompt {
  id: VisionPresetType;
  label: string;
  iconName: string;
  prompt: string;
  description: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
}

export interface VisionAnalysisOptions {
  imageDataUrl: string;
  query: string;
  cropRect?: CropRect;
  pageTitle?: string;
  pageUrl?: string;
  language?: OutputLanguage;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface VisionStreamAnalysisOptions extends VisionAnalysisOptions {
  onChunk?: StreamChunkHandler;
}

export interface VisionAnalysisResult {
  text: string;
  model: string;
  finishReason?: string;
  usage?: GeminiUsageMetadata;
}

// ---------------------------------------------------------------------------
// Slice 2.4: Groq Cloud API & Free-Tier Fallback Types
// ---------------------------------------------------------------------------

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatCompletionRequest {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string[];
}

export interface GroqChatChoice {
  index: number;
  message?: {
    role: string;
    content: string;
  };
  delta?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string;
}

export interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface GroqChatCompletionResponse {
  id?: string;
  choices?: GroqChatChoice[];
  usage?: GroqUsage;
  error?: {
    message: string;
    type?: string;
    code?: string | number;
  };
}

export interface ResilientExecutionOptions extends StreamOptions {
  groqApiKey?: string;
  groqModel?: string;
  maxRetries?: number;
  delays?: number[];
  enableFallback?: boolean;
  onFallback?: (provider: AIProvider, reason: string) => void;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Whether to automatically truncate overly long prompts to fit model token boundaries and mitigate rate limits */
  truncatePrompt?: boolean;
  /** Maximum prompt character limit when truncation is enabled (default: 24,000 chars) */
  maxPromptChars?: number;
}

export interface ResilientExecutionResult extends GenerateResult {
  provider: AIProvider;
  usedFallback: boolean;
  retryAttempts: number;
  fallbackNotice?: string;
}

export interface RateLimiterOptions {
  maxRetries?: number;
  delays?: number[];
  signal?: AbortSignal;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface RateLimitStatus {
  isRateLimited: boolean;
  retryAfterSeconds: number;
  bannerMessage: string;
  provider: AIProvider;
  timestamp: number;
}


