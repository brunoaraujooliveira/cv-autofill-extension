import { z } from 'zod';
import type { FileMeta } from '../../shared/answers';
import type { UploadFile } from '../../shared/types';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'resumeFile';
/** Keeps the file well inside the extension's local storage quota. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const fileSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  base64: z.string().min(1),
});

function byteSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

export function toFileMeta(file: UploadFile): FileMeta {
  return { name: file.name, type: file.type, size: byteSize(file.base64) };
}

/** The resume document (usually a PDF) attached to upload fields. */
export class ResumeFileRepository {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<UploadFile | null> {
    const parsed = fileSchema.safeParse(await this.store.get(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  }

  async save(candidate: unknown): Promise<FileMeta> {
    const file = fileSchema.parse(candidate);
    if (byteSize(file.base64) > MAX_FILE_BYTES) throw new Error('The file is larger than 4 MB');
    await this.store.set(STORAGE_KEY, file);
    return toFileMeta(file);
  }

  remove(): Promise<void> {
    return this.store.remove(STORAGE_KEY);
  }
}
