import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChromeLocalStore, InMemoryStore } from '../../../src/background/storage/key-value-store';
import { ResumeRepository } from '../../../src/background/storage/resume';
import { DEFAULT_SETTINGS, SettingsRepository } from '../../../src/background/storage/settings';

describe('SettingsRepository', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await new SettingsRepository(new InMemoryStore()).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a patch over what is stored', async () => {
    const repository = new SettingsRepository(new InMemoryStore());
    await repository.save({ apiKey: 'key-1', locale: 'pt' });
    const saved = await repository.save({ fillDelayMs: 300 });
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, apiKey: 'key-1', locale: 'pt', fillDelayMs: 300 });
    expect(await repository.load()).toEqual(saved);
  });

  it('fills settings added in newer versions with their defaults', async () => {
    const store = new InMemoryStore();
    await store.set('settings', { apiKey: 'key-1' });
    expect(await new SettingsRepository(store).load()).toEqual({
      ...DEFAULT_SETTINGS,
      apiKey: 'key-1',
    });
  });

  it.each([{ fillDelayMs: -1 }, { fillDelayMs: 99999 }, { model: '  ' }, { locale: 'de' }])(
    'rejects the invalid patch %o',
    async (patch) => {
      const repository = new SettingsRepository(new InMemoryStore());
      await expect(repository.save(patch as never)).rejects.toThrow();
      expect(await repository.load()).toEqual(DEFAULT_SETTINGS);
    },
  );

  it.each(['garbage', ['a'], { fillDelayMs: 'slow' }])(
    'falls back to the defaults when storage holds %o',
    async (stored) => {
      const store = new InMemoryStore();
      await store.set('settings', stored);
      expect(await new SettingsRepository(store).load()).toEqual(DEFAULT_SETTINGS);
    },
  );
});

describe('ResumeRepository', () => {
  const resume = { basics: { name: 'Ana', email: 'ana@example.com' } };

  it('returns null when nothing is stored', async () => {
    expect(await new ResumeRepository(new InMemoryStore()).load()).toBeNull();
  });

  it('saves and reloads a valid resume', async () => {
    const repository = new ResumeRepository(new InMemoryStore());
    await repository.save(resume);
    expect(await repository.load()).toEqual(resume);
  });

  it('rejects an invalid resume and keeps the previous one', async () => {
    const repository = new ResumeRepository(new InMemoryStore());
    await repository.save(resume);
    await expect(repository.save({ basics: { name: 'Ana' } })).rejects.toThrow();
    expect(await repository.load()).toEqual(resume);
  });
});

describe('InMemoryStore', () => {
  it('isolates stored values from later mutations', async () => {
    const store = new InMemoryStore();
    const value = { list: [1] };
    await store.set('key', value);
    value.list.push(2);
    expect(await store.get('key')).toEqual({ list: [1] });
  });

  it('removes values', async () => {
    const store = new InMemoryStore();
    await store.set('key', 1);
    await store.remove('key');
    expect(await store.get('key')).toBeUndefined();
  });
});

describe('ChromeLocalStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delegates to chrome.storage.local', async () => {
    const local = {
      get: vi.fn().mockResolvedValue({ key: 'value' }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('chrome', { storage: { local } });
    const store = new ChromeLocalStore();

    expect(await store.get('key')).toBe('value');
    await store.set('key', 'next');
    await store.remove('key');

    expect(local.get).toHaveBeenCalledWith('key');
    expect(local.set).toHaveBeenCalledWith({ key: 'next' });
    expect(local.remove).toHaveBeenCalledWith('key');
  });
});
