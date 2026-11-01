/**
 * ASKbro Settings & API Key Storage Service
 *
 * Persists user API credentials and configuration securely inside chrome.storage.local.
 * Keys are kept strictly on the user's local machine and never sent to external telemetry.
 */

import { AISettings, ConnectionTestResult, DEFAULT_SETTINGS, DEFAULT_GEMINI_MODEL, AIProvider, OutputLanguage } from '../../types/ai';
import { getLocalStorage, setLocalStorage, removeLocalStorage } from './index';

export const SETTINGS_STORAGE_KEY = 'askbro_settings';

/**
 * Retrieve current AI configuration from chrome.storage.local
 */
export async function getSettings(): Promise<AISettings> {
  const stored = await getLocalStorage<Partial<AISettings>>(SETTINGS_STORAGE_KEY, {});
  let model = stored.model ? stored.model.trim().replace(/^models\//, '') : DEFAULT_GEMINI_MODEL;
  if (
    model === 'gemini-2.0-flash' ||
    !model
  ) {
    model = DEFAULT_GEMINI_MODEL;
  }
  return {
    geminiApiKey: stored.geminiApiKey?.trim() ?? DEFAULT_SETTINGS.geminiApiKey,
    groqApiKey: (stored.groqApiKey && stored.groqApiKey.trim().length > 0) ? stored.groqApiKey.trim() : DEFAULT_SETTINGS.groqApiKey,
    language: stored.language ?? DEFAULT_SETTINGS.language,
    model,
  };
}

/**
 * Update and persist settings in chrome.storage.local
 */
export async function saveSettings(updates: Partial<AISettings>): Promise<AISettings> {
  const current = await getSettings();
  const updated: AISettings = {
    ...current,
    ...updates,
    geminiApiKey: updates.geminiApiKey !== undefined ? updates.geminiApiKey.trim() : current.geminiApiKey,
    groqApiKey: updates.groqApiKey !== undefined ? updates.groqApiKey.trim() : current.groqApiKey,
  };

  await setLocalStorage(SETTINGS_STORAGE_KEY, updated);
  return updated;
}

/**
 * Fetch the active Gemini API key
 */
export async function getGeminiApiKey(): Promise<string> {
  const settings = await getSettings();
  return settings.geminiApiKey;
}

/**
 * Fetch the active Groq fallback API key
 */
export async function getGroqApiKey(): Promise<string> {
  const settings = await getSettings();
  return settings.groqApiKey || '';
}

/**
 * Check if a Gemini API key is configured
 */
export async function hasGeminiKey(): Promise<boolean> {
  const key = await getGeminiApiKey();
  return key.length >= 10;
}

/**
 * Fetch the active output language preference ('en' | 'hinglish')
 */
export async function getLanguage(): Promise<OutputLanguage> {
  const settings = await getSettings();
  return settings.language || 'en';
}

/**
 * Persist output language preference ('en' | 'hinglish') to chrome.storage.local
 */
export async function setLanguage(language: OutputLanguage): Promise<AISettings> {
  return await saveSettings({ language });
}

/**
 * Clear a specific provider's API key
 */
export async function clearApiKey(provider: AIProvider): Promise<void> {
  if (provider === 'gemini') {
    await saveSettings({ geminiApiKey: '' });
  } else if (provider === 'groq') {
    await saveSettings({ groqApiKey: '' });
  }
}

/**
 * Reset all settings to default values
 */
export async function clearAllSettings(): Promise<void> {
  await removeLocalStorage(SETTINGS_STORAGE_KEY);
}

/**
 * Test Gemini API connection with a live lightweight ping
 */
export async function testGeminiConnection(apiKey: string, model: string = DEFAULT_GEMINI_MODEL): Promise<ConnectionTestResult> {
  const cleanKey = apiKey.trim();
  const timestamp = Date.now();

  if (!cleanKey) {
    return {
      provider: 'gemini',
      success: false,
      message: 'Please enter a Gemini API key before testing connection.',
      timestamp,
    };
  }

  const startTime = performance.now();

  try {
    let targetModel = model.replace(/^models\//, '');
    if (
      targetModel === 'gemini-2.0-flash' ||
      !targetModel
    ) {
      targetModel = DEFAULT_GEMINI_MODEL;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: {
          maxOutputTokens: 2,
        },
      }),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        provider: 'gemini',
        success: true,
        message: `Connected to ${targetModel} successfully!`,
        latencyMs,
        timestamp,
      };
    }

    // Parse API error details if returned
    let errorDetail = '';
    try {
      const errorJson = await response.json();
      errorDetail = errorJson?.error?.message || '';
    } catch {
      // response was not JSON
    }

    if (response.status === 400) {
      return {
        provider: 'gemini',
        success: false,
        message: errorDetail ? `API Key Invalid: ${errorDetail}` : 'Invalid Gemini API key. Please check your key from Google AI Studio.',
        latencyMs,
        timestamp,
      };
    }

    if (response.status === 403) {
      return {
        provider: 'gemini',
        success: false,
        message: 'Permission denied. Ensure the Generative Language API is enabled for your project.',
        latencyMs,
        timestamp,
      };
    }

    if (response.status === 404) {
      return {
        provider: 'gemini',
        success: false,
        message: errorDetail || `Model ${targetModel} not found for this API key.`,
        latencyMs,
        timestamp,
      };
    }

    if (response.status === 429) {
      return {
        provider: 'gemini',
        success: false,
        message: 'Rate limit / quota reached (HTTP 429). The key is valid, but free-tier request limit was hit.',
        latencyMs,
        timestamp,
      };
    }

    return {
      provider: 'gemini',
      success: false,
      message: `Gemini API returned status ${response.status}: ${errorDetail || response.statusText}`,
      latencyMs,
      timestamp,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errMessage = err instanceof Error ? err.message : 'Unknown network failure';
    return {
      provider: 'gemini',
      success: false,
      message: `Network error: ${errMessage}. Check your internet connection.`,
      latencyMs,
      timestamp,
    };
  }
}

/**
 * Test Groq Cloud API connection (Optional Fallback)
 */
export async function testGroqConnection(apiKey: string): Promise<ConnectionTestResult> {
  const cleanKey = apiKey.trim();
  const timestamp = Date.now();

  if (!cleanKey) {
    return {
      provider: 'groq',
      success: false,
      message: 'Please enter a Groq API key before testing connection.',
      timestamp,
    };
  }

  const startTime = performance.now();

  try {
    const endpoint = 'https://api.groq.com/openai/v1/models';

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        provider: 'groq',
        success: true,
        message: 'Connected to Groq Cloud API successfully!',
        latencyMs,
        timestamp,
      };
    }

    if (response.status === 401) {
      return {
        provider: 'groq',
        success: false,
        message: 'Invalid Groq API key. Check your key in the Groq console.',
        latencyMs,
        timestamp,
      };
    }

    if (response.status === 429) {
      return {
        provider: 'groq',
        success: false,
        message: 'Groq quota or rate limit exceeded (HTTP 429).',
        latencyMs,
        timestamp,
      };
    }

    return {
      provider: 'groq',
      success: false,
      message: `Groq API returned status ${response.status}: ${response.statusText}`,
      latencyMs,
      timestamp,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errMessage = err instanceof Error ? err.message : 'Unknown network failure';
    return {
      provider: 'groq',
      success: false,
      message: `Network error: ${errMessage}. Check your internet connection.`,
      latencyMs,
      timestamp,
    };
  }
}
