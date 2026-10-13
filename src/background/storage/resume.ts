import { resumeSchema, type Resume } from '../../shared/resume';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'resume';

export class ResumeRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<Resume | null> {
    const parsed = resumeSchema.safeParse(await this.store.get(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  }

  /** Re-validates on the way in: the service worker does not trust what a page sends. */
  async save(candidate: unknown): Promise<Resume> {
    const resume = resumeSchema.parse(candidate);
    await this.store.set(STORAGE_KEY, resume);
    return resume;
  }
}
