export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class ChromeLocalStore implements KeyValueStore {
  async get(key: string): Promise<unknown> {
    const items = await chrome.storage.local.get(key);
    return items[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

export class InMemoryStore implements KeyValueStore {
  private readonly items = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(structuredClone(this.items.get(key)));
  }

  set(key: string, value: unknown): Promise<void> {
    this.items.set(key, structuredClone(value));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.items.delete(key);
    return Promise.resolve();
  }
}
