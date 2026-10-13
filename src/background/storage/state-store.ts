import { z } from 'zod';
import { RUN_PHASES, type RunState } from '../../shared/types';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'runs';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tab id of a run whose tab is gone; it can still be resumed from its key. */
export const NO_TAB = -1;

type StoredRuns = Record<string, RunState>;

/**
 * Identifies an application by its address, so it can be found again after the tab closes.
 * Query and fragment are part of it: many portals tell jobs apart only by a parameter.
 */
export function runKey(url: string): string {
  try {
    const { hostname, pathname, search, hash } = new URL(url);
    return `${hostname}${pathname.replace(/\/+$/, '')}${search}${hash}`;
  } catch {
    return url;
  }
}

/** The parts of a stored run the code relies on; anything else is carried along untouched. */
const storedRunSchema = z.looseObject({
  tabId: z.number(),
  key: z.string(),
  phase: z.enum(RUN_PHASES),
  stepNumber: z.number(),
  decisions: z.array(z.looseObject({ fieldId: z.string() })),
  results: z.array(z.looseObject({ fieldId: z.string() })),
  decided: z.record(z.string(), z.looseObject({ fieldId: z.string() })),
  attempts: z.record(z.string(), z.number()),
  added: z.record(z.string(), z.number()),
  updatedAt: z.number(),
});

/** Persists runs so they survive reloads, a closed tab, or the service worker going to sleep. */
export class StateStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  save(state: RunState): Promise<void> {
    return this.mutate((runs) => ({ ...runs, [state.key]: state }));
  }

  async loadByTab(tabId: number): Promise<RunState | null> {
    await this.pending;
    const runs = Object.values(await this.readFresh()).filter((run) => run.tabId === tabId);
    return runs.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }

  async loadByKey(key: string): Promise<RunState | null> {
    await this.pending;
    return (await this.readFresh())[key] ?? null;
  }

  remove(key: string): Promise<void> {
    return this.mutate(({ [key]: _removed, ...rest }) => rest);
  }

  /** Forgets which tab runs belonged to. Tab ids mean nothing after a tab closes or Chrome restarts. */
  detachTabs(tabId?: number): Promise<void> {
    return this.mutate((runs) =>
      Object.fromEntries(
        Object.entries(runs).map(([key, run]) => [
          key,
          tabId === undefined || run.tabId === tabId ? { ...run, tabId: NO_TAB } : run,
        ]),
      ),
    );
  }

  /**
   * Applies a change to the stored runs. Changes are queued: each one reads what the previous
   * one wrote, so updates published in quick succession never overwrite each other.
   */
  private mutate(change: (runs: StoredRuns) => StoredRuns): Promise<void> {
    const next = this.pending.then(async () => {
      await this.store.set(STORAGE_KEY, change(await this.readFresh()));
    });
    this.pending = next.catch(() => undefined);
    return next;
  }

  /** Stored runs that are still recent and have the shape this version expects. */
  private async readFresh(): Promise<StoredRuns> {
    const stored = await this.store.get(STORAGE_KEY);
    if (typeof stored !== 'object' || stored === null) return {};
    const oldest = this.now() - MAX_AGE_MS;
    const runs: StoredRuns = {};
    for (const [key, candidate] of Object.entries(stored)) {
      const parsed = storedRunSchema.safeParse(candidate);
      if (parsed.success && parsed.data.updatedAt >= oldest) runs[key] = candidate as RunState;
    }
    return runs;
  }
}
