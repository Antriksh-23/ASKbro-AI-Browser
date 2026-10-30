/**
 * Local-First Storage Service (chrome.storage.local & chrome.storage.session)
 */

export async function getLocalStorage<T>(key: string, defaultValue: T): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return defaultValue;
  }
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? defaultValue;
}

export async function setLocalStorage<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}
