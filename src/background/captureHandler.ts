/**
 * ASKbro Tab Capture Handler (Slice 2.3)
 *
 * Implements visible tab screenshot capture via chrome.tabs.captureVisibleTab,
 * Data URL parsing and validation, and cross-context message handling for the side panel.
 */

import {
  CaptureScreenshotMessage,
  CaptureScreenshotResponse,
} from '../types/messages';

export interface CaptureTabOptions {
  windowId?: number | null;
  format?: 'png' | 'jpeg';
  quality?: number;
}

/**
 * Validates whether a value is a valid image base64 Data URL
 */
export function isDataUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) {
    return false;
  }
  const parts = value.split(';base64,');
  return parts.length === 2 && parts[1].length > 0;
}

/**
 * Parses an image Data URL into its MIME type and raw base64 data payload
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } {
  if (!isDataUrl(dataUrl)) {
    throw new Error('Invalid image Data URL: expected data:image/<format>;base64,<data>');
  }

  const [header, base64Data] = dataUrl.split(';base64,');
  const mimeType = header.replace(/^data:/, '').trim() || 'image/png';

  return {
    mimeType,
    base64Data: base64Data.trim(),
  };
}

/**
 * Captures the visible area of the currently active tab in the specified window.
 * Uses chrome.tabs.captureVisibleTab(null, { format: 'png' }).
 *
 * @param options Target windowId (null for current window), image format ('png' | 'jpeg'), and quality
 * @returns Base64 PNG or JPEG Data URL
 */
export async function captureActiveTabScreenshot(options?: CaptureTabOptions): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    throw new Error('Chrome tabs API is not available in the current environment.');
  }

  if (typeof chrome.tabs.captureVisibleTab !== 'function') {
    throw new Error('chrome.tabs.captureVisibleTab is not supported in this context.');
  }

  let windowId = options?.windowId !== undefined ? options.windowId : null;
  if (windowId === null && typeof chrome !== 'undefined' && chrome.windows?.getLastFocused) {
    try {
      const win = await chrome.windows.getLastFocused({ populate: false });
      if (win?.id) {
        windowId = win.id;
      }
    } catch {
      // Fallback to null
    }
  }

  const imageDetails: { format?: 'png' | 'jpeg'; quality?: number } = {
    format: options?.format || 'png',
  };

  if (options?.quality !== undefined && options.format === 'jpeg') {
    imageDetails.quality = options.quality;
  }

  return new Promise<string>((resolve, reject) => {
    try {
      let settled = false;

      const callback = (dataUrl?: string) => {
        if (settled) return;
        settled = true;

        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          const msg = lastError.message || String(lastError);
          const lower = msg.toLowerCase();
          if (
            lower.includes('cannot access') ||
            lower.includes('restricted') ||
            lower.includes('all_urls') ||
            lower.includes('activetab')
          ) {
            reject(
              new Error(
                'Cannot capture internal browser pages (chrome://, Web Store, or empty tabs). Please switch to a web page.'
              )
            );
          } else {
            reject(new Error(`Failed to capture tab screenshot: ${msg}`));
          }
          return;
        }

        if (!dataUrl || !isDataUrl(dataUrl)) {
          reject(new Error('chrome.tabs.captureVisibleTab returned an empty or invalid image Data URL.'));
          return;
        }

        resolve(dataUrl);
      };

      // Support callback and promise returning variants
      const result: any = (chrome.tabs.captureVisibleTab as any)(
        windowId,
        imageDetails,
        callback
      );

      // If the API returned a native Promise and didn't invoke callback synchronously
      if (result && typeof result.then === 'function') {
        result
          .then((dataUrl: string) => {
            if (!settled) {
              settled = true;
              if (!dataUrl || !isDataUrl(dataUrl)) {
                reject(new Error('chrome.tabs.captureVisibleTab returned an empty or invalid image Data URL.'));
              } else {
                resolve(dataUrl);
              }
            }
          })
          .catch((err: any) => {
            if (!settled) {
              settled = true;
              const msg = err?.message || String(err);
              const lower = msg.toLowerCase();
              if (
                lower.includes('cannot access') ||
                lower.includes('restricted') ||
                lower.includes('all_urls') ||
                lower.includes('activetab')
              ) {
                reject(
                  new Error(
                    'Cannot capture internal browser pages (chrome://, Web Store, or empty tabs). Please switch to a web page.'
                  )
                );
              } else {
                reject(new Error(`Failed to capture tab screenshot: ${msg}`));
              }
            }
          });
      }
    } catch (err: any) {
      reject(new Error(`Exception during captureVisibleTab: ${err?.message || String(err)}`));
    }
  });
}

/**
 * Handles incoming CAPTURE_SCREENSHOT messages in the service worker
 */
export async function handleCaptureScreenshotMessage(
  message: CaptureScreenshotMessage
): Promise<CaptureScreenshotResponse> {
  try {
    const dataUrl = await captureActiveTabScreenshot({
      windowId: message.windowId,
      format: message.format,
      quality: message.quality,
    });

    return {
      success: true,
      dataUrl,
    };
  } catch (err: any) {
    console.error('[ASKbro CaptureHandler] Error capturing active tab:', err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * High-level helper for UI callers (Side Panel, Content Script) to request a screenshot.
 * Attempts direct captureVisibleTab first if available, otherwise delegates to background worker.
 */
export async function requestTabScreenshot(options?: CaptureTabOptions): Promise<string> {
  // If tabs.captureVisibleTab is directly accessible in caller context, use it
  const hasTabsCapture =
    typeof chrome !== 'undefined' &&
    typeof (chrome.tabs as any)?.captureVisibleTab === 'function';

  if (hasTabsCapture) {
    try {
      return await captureActiveTabScreenshot(options);
    } catch (err) {
      console.warn('[ASKbro CaptureHandler] Direct capture failed, falling back to service worker:', err);
    }
  }

  // Fallback: send message to background service worker
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    const response: CaptureScreenshotResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'CAPTURE_SCREENSHOT',
          windowId: options?.windowId,
          format: options?.format || 'png',
          quality: options?.quality,
        },
        (res: CaptureScreenshotResponse) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message || 'Background message communication failed',
            });
          } else {
            resolve(res);
          }
        }
      );
    });

    if (response.success && response.dataUrl) {
      return response.dataUrl;
    }

    throw new Error(response.error || 'Failed to capture screenshot from service worker.');
  }

  throw new Error('Chrome runtime messaging and tabs API are both unavailable in this environment.');
}
