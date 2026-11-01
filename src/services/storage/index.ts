/**
 * Local-First Storage Service (chrome.storage.local & chrome.storage.session)
 * Provides automatic fallback to window.localStorage in browser dev preview.
 */

export async function getLocalStorage<T>(key: string, defaultValue: T): Promise<T> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const result = await chrome.storage.local.get(key);
      return (result[key] as T) ?? defaultValue;
    } catch (err) {
      console.warn(`[ASKbro Storage] Failed to read ${key} from chrome.storage.local:`, err);
      return defaultValue;
    }
  }

  // Fallback for dev previews / browser testing
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw !== null) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // Ignore parse errors and return default
  }
  return defaultValue;
}

export async function setLocalStorage<T>(key: string, value: T): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return;
    } catch (err) {
      console.error(`[ASKbro Storage] Failed to write ${key} to chrome.storage.local:`, err);
    }
  }

  // Fallback for dev preview
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[ASKbro Storage] Failed to write ${key} to window.localStorage:`, err);
  }
}

export async function removeLocalStorage(key: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.remove(key);
      return;
    } catch (err) {
      console.error(`[ASKbro Storage] Failed to remove ${key} from chrome.storage.local:`, err);
    }
  }

  try {
    window.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

export async function getSessionStorage<T>(key: string, defaultValue: T): Promise<T> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      const result = await chrome.storage.session.get(key);
      return (result[key] as T) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }

  try {
    const raw = window.sessionStorage?.getItem(key);
    if (raw !== null) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

export async function setSessionStorage<T>(key: string, value: T): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      await chrome.storage.session.set({ [key]: value });
      return;
    } catch (err) {
      console.error(`[ASKbro Storage] Failed to write ${key} to chrome.storage.session:`, err);
    }
  }

  try {
    window.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function removeSessionStorage(key: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      await chrome.storage.session.remove(key);
      return;
    } catch (err) {
      console.error(`[ASKbro Storage] Failed to remove ${key} from chrome.storage.session:`, err);
    }
  }

  try {
    window.sessionStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

export * from './settingsStore';
export * from './profileStore';
export * from './skillsStore';
export * from './tabChatStore';
export * from './historyStore';
