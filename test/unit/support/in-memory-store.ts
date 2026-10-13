import type { KeyValueStore } from '../../../src/background/storage/key-value-store';

/** A store that lives in memory, standing in for the browser's storage in unit tests. */
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
