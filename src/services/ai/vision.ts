/**
 * ASKbro Visual Screen Understanding Service (Slice 2.3)
 *
 * Implements multimodal screen understanding via Gemini 1.5 Flash:
 * - Multimodal payload assembly (image/png + user prompt)
 * - Specialized analysis for Charts, Visual Tables, Errors, and UI Layouts
 * - Interactive Crop / Inspector region processing
 * - Real-time SSE streaming with typing feedback
 * - English and colloquial Hinglish support
 */

import {
  CropRect,
  GeminiContent,
  OutputLanguage,
  VISION_DEFAULT_MODEL,
  VisionAnalysisOptions,
  VisionAnalysisResult,
  VisionPresetPrompt,
  VisionPresetType,
  VisionStreamAnalysisOptions,
} from '../../types/ai';
import { generateContent, streamGenerateContent, GeminiError } from './gemini';
import { parseDataUrl, isDataUrl } from '../../background/captureHandler';

export { VISION_DEFAULT_MODEL };

/**
 * Standard preset prompts for instant screen analysis
 */
export const VISION_PRESET_PROMPTS: Record<VisionPresetType, VisionPresetPrompt> = {
  chart: {
    id: 'chart',
    label: 'Explain Chart / Graph',
    iconName: 'BarChart3',
    prompt:
      'Analyze this chart or graph in detail. Identify the chart type, axis labels, units of measurement, key trend lines, peak and minimum values, percentages, and notable anomalies.',
    description: 'Interpret graphs, plots, axes, trends, and percentages',
  },
  table: {
    id: 'table',
    label: 'Extract Table Data',
    iconName: 'Table',
    prompt:
      'Extract all visible tabular data from this screen or selected region and convert it into a clean, well-formatted Markdown table with correct column headers and row alignments.',
    description: 'Convert image tables and spreadsheets into Markdown',
  },
  error: {
    id: 'error',
    label: 'Diagnose Error / Bug',
    iconName: 'AlertTriangle',
    prompt:
      'Identify the error message, warning banner, or crash log visible on this screen. Transcribe the exact error text, explain why it occurred, and provide step-by-step troubleshooting suggestions.',
    description: 'Inspect error dialogs, console logs, and stack traces',
  },
  ui: {
    id: 'ui',
    label: 'Analyze UI & Workflow',
    iconName: 'Layout',
    prompt:
      'Analyze the UI components, layout hierarchy, and visible buttons or forms on this screen. Explain the page structure and the next action the user should take.',
    description: 'Understand interface layout, wireframes, and controls',
  },
  general: {
    id: 'general',
    label: 'Summarize Screen',
    iconName: 'Eye',
    prompt:
      'Provide a comprehensive visual summary of what is visible on this screen, highlighting key information, visual callouts, and main takeaways.',
    description: 'General overview and visual Q&A',
  },
};

export const VISION_PRESET_LIST: VisionPresetPrompt[] = [
  VISION_PRESET_PROMPTS.chart,
  VISION_PRESET_PROMPTS.table,
  VISION_PRESET_PROMPTS.error,
  VISION_PRESET_PROMPTS.ui,
  VISION_PRESET_PROMPTS.general,
];

/**
 * Constructs the system instruction for multimodal visual screen analysis
 */
export function buildVisionSystemInstruction(language: OutputLanguage = 'en'): string {
  const isHinglish = language === 'hinglish';

  if (isHinglish) {
    return `You are ASKbro Vision, an expert browser AI assistant specializing in visual screen understanding and OCR.
You analyze screenshots captured directly from the user's active browser window.

CORE CAPABILITIES & INSTRUCTIONS:
1. CHARTS & GRAPHS: Identify chart type (bar, line, pie, area, scatter), read X/Y axis labels, note peak values, percentage changes, and overall trends.
2. TABLES & DATA: Transcribe visual table rows and columns cleanly into Markdown tables. Keep numbers and currency exact.
3. ERROR CALLOUTS & CRASHES: Accurately read stack traces, modal alerts, HTTP error status codes, or form validations. Explain root causes and provide practical solutions.
4. UI & LAYOUT DIAGRAMS: Describe visual hierarchy, prominent buttons, input fields, and intended user flow.
5. STRICT VISUAL GROUNDING: Rely strictly on what is visible in the provided image. If an element or text is blurry, cropped, or ambiguous, state that clearly instead of guessing.

LANGUAGE & TONE:
- Explain everything in conversational Hinglish (Hindi written in Roman English script, widely used in India, e.g., "Yeh chart dikhaata hai ki revenue 25% badha hai...", "Screen par yeh validation error aa raha hai: ...").
- Keep technical terms, code snippets, numbers, button labels, and UI text in English.
- Use clean Markdown with bold lead-ins, bullet points, and code blocks for readability.`;
  }

  return `You are ASKbro Vision, an expert browser AI assistant specializing in visual screen understanding and OCR.
You analyze screenshots captured directly from the user's active browser window.

CORE CAPABILITIES & INSTRUCTIONS:
1. CHARTS & GRAPHS: Identify chart type (bar, line, pie, area, scatter), read X/Y axis labels, note peak values, percentage changes, and overall trends.
2. TABLES & DATA: Transcribe visual table rows and columns cleanly into Markdown tables. Keep numbers, currencies, and headers exact.
3. ERROR CALLOUTS & CRASHES: Accurately read stack traces, modal alerts, HTTP error status codes, or form validations. Explain root causes and provide actionable step-by-step solutions.
4. UI & LAYOUT DIAGRAMS: Describe visual hierarchy, prominent buttons, input fields, and intended user workflow.
5. STRICT VISUAL GROUNDING: Rely strictly on what is visible in the provided image. If an element or text is blurry, cropped, or ambiguous, state that clearly instead of inventing details.

FORMATTING:
- Structure your response using clean Markdown with bold headings and bullet points.
- When extracting tabular data, use GitHub-flavored Markdown tables.
- Be concise, direct, and actionable. Avoid filler phrases like "Sure, I can help you with that".`;
}

/**
 * Extracts and validates the base64 payload from an image Data URL
 */
export function cleanBase64FromDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const { mimeType, base64Data } = parseDataUrl(dataUrl);
  if (!base64Data) {
    throw new Error('Image base64 payload is empty.');
  }
  return {
    mimeType,
    data: base64Data,
  };
}

/**
 * Wraps user query and optional page metadata into a sanitized vision user prompt
 */
export function buildVisionUserPrompt(
  query: string,
  metadata?: { pageTitle?: string; pageUrl?: string }
): string {
  const cleanQuery = (query || '').trim() || VISION_PRESET_PROMPTS.general.prompt;

  if (!metadata?.pageTitle && !metadata?.pageUrl) {
    return cleanQuery;
  }

  const sanitizedTitle = (metadata.pageTitle || '').replace(/<\/?screen_context>/gi, '').trim();
  const sanitizedUrl = (metadata.pageUrl || '').replace(/<\/?screen_context>/gi, '').trim();

  let contextHeader = '<screen_context>\n';
  if (sanitizedTitle) {
    contextHeader += `Page Title: ${sanitizedTitle}\n`;
  }
  if (sanitizedUrl) {
    contextHeader += `Page URL: ${sanitizedUrl}\n`;
  }
  contextHeader += '</screen_context>\n\n';

  return `${contextHeader}${cleanQuery}`;
}

/**
 * Assembles Gemini multimodal contents payload combining image inline data and user text prompt
 */
export function buildVisionMultimodalContents(
  imageDataUrl: string,
  promptText: string
): GeminiContent[] {
  const { mimeType, data } = cleanBase64FromDataUrl(imageDataUrl);

  return [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType,
            data,
          },
        },
        {
          text: promptText,
        },
      ],
    },
  ];
}

/**
 * Normalizes CSS display crop coordinates to the image's actual natural pixel dimensions
 */
export function normalizeCropCoordinates(
  rect: CropRect,
  naturalWidth: number,
  naturalHeight: number
): CropRect {
  const displayWidth = rect.displayWidth || naturalWidth;
  const displayHeight = rect.displayHeight || naturalHeight;

  const scaleX = naturalWidth / Math.max(displayWidth, 1);
  const scaleY = naturalHeight / Math.max(displayHeight, 1);

  const rawX = Math.round(rect.x * scaleX);
  const rawY = Math.round(rect.y * scaleY);
  const rawW = Math.round(rect.width * scaleX);
  const rawH = Math.round(rect.height * scaleY);

  // Clamp within image bounds
  const x = Math.max(0, Math.min(rawX, naturalWidth - 1));
  const y = Math.max(0, Math.min(rawY, naturalHeight - 1));
  const width = Math.max(1, Math.min(rawW, naturalWidth - x));
  const height = Math.max(1, Math.min(rawH, naturalHeight - y));

  return { x, y, width, height, displayWidth: naturalWidth, displayHeight: naturalHeight };
}

/**
 * Crops an image Data URL using HTML Canvas in client browser environments.
 * If canvas is unavailable (e.g. Node test environment), returns the original Data URL safely.
 */
export async function cropImageDataUrl(dataUrl: string, cropRect: CropRect): Promise<string> {
  if (!isDataUrl(dataUrl)) {
    throw new Error('Invalid image Data URL provided for cropping.');
  }

  // Check if browser DOM environment with HTMLCanvasElement is available
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return dataUrl;
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        const normalized = normalizeCropCoordinates(cropRect, naturalW, naturalH);

        const canvas = document.createElement('canvas');
        canvas.width = normalized.width;
        canvas.height = normalized.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(
          img,
          normalized.x,
          normalized.y,
          normalized.width,
          normalized.height,
          0,
          0,
          normalized.width,
          normalized.height
        );

        const croppedDataUrl = canvas.toDataURL('image/png');
        resolve(croppedDataUrl);
      } catch (err) {
        reject(new Error(`Failed to crop screenshot image: ${err instanceof Error ? err.message : String(err)}`));
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image Data URL into Image element for cropping.'));
    };

    img.src = dataUrl;
  });
}

/**
 * Analyzes a screenshot non-streamingly with Gemini 1.5 Flash multimodal API
 */
export async function analyzeScreenshot(options: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
  let targetDataUrl = options.imageDataUrl;

  if (options.cropRect && options.cropRect.width > 10 && options.cropRect.height > 10) {
    try {
      targetDataUrl = await cropImageDataUrl(targetDataUrl, options.cropRect);
    } catch (err) {
      console.warn('[ASKbro Vision] Cropping failed, falling back to full screenshot:', err);
    }
  }

  const model = options.model || VISION_DEFAULT_MODEL;
  const systemInstruction = buildVisionSystemInstruction(options.language || 'en');
  const userPrompt = buildVisionUserPrompt(options.query, {
    pageTitle: options.pageTitle,
    pageUrl: options.pageUrl,
  });

  const contents = buildVisionMultimodalContents(targetDataUrl, userPrompt);

  const result = await generateContent(contents, {
    apiKey: options.apiKey,
    model,
    systemInstruction,
    signal: options.signal,
    temperature: 0.2,
  });

  return {
    text: result.text,
    model: result.model || model,
    finishReason: result.finishReason,
    usage: result.usage,
  };
}

/**
 * Streams a screenshot visual analysis response via Gemini SSE
 */
export async function streamAnalyzeScreenshot(
  options: VisionStreamAnalysisOptions
): Promise<VisionAnalysisResult> {
  let targetDataUrl = options.imageDataUrl;

  if (options.cropRect && options.cropRect.width > 10 && options.cropRect.height > 10) {
    try {
      targetDataUrl = await cropImageDataUrl(targetDataUrl, options.cropRect);
    } catch (err) {
      console.warn('[ASKbro Vision] Cropping failed, falling back to full screenshot:', err);
    }
  }

  const model = options.model || VISION_DEFAULT_MODEL;
  const systemInstruction = buildVisionSystemInstruction(options.language || 'en');
  const userPrompt = buildVisionUserPrompt(options.query, {
    pageTitle: options.pageTitle,
    pageUrl: options.pageUrl,
  });

  const contents = buildVisionMultimodalContents(targetDataUrl, userPrompt);

  const result = await streamGenerateContent(contents, {
    apiKey: options.apiKey,
    model,
    systemInstruction,
    signal: options.signal,
    temperature: 0.2,
    onChunk: options.onChunk,
  });

  return {
    text: result.text,
    model: result.model || model,
    finishReason: result.finishReason,
    usage: result.usage,
  };
}

