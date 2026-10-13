import { z } from 'zod';
import type { AnswerEntry } from '../../shared/answers';
import { hashText, isFormatHint, normalizeForMatch } from '../../shared/text';
import type { KeyValueStore } from './key-value-store';

const STORAGE_KEY = 'answers';

const entrySchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.union([z.string(), z.array(z.string())]),
  updatedAt: z.number(),
});

/** Answers the user gave to questions the resume does not cover, reused across applications. */
export class AnswerBank {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<AnswerEntry[]> {
    const parsed = z.array(entrySchema).safeParse(await this.store.get(STORAGE_KEY));
    // Questions that are only a format ("dd-mm-yyyy") came from fields without a real label.
    return parsed.success ? parsed.data.filter((entry) => !isFormatHint(entry.question)) : [];
  }

  /** Stores the answer to a question, replacing the previous answer to the same question. */
  async remember(question: string, answer: AnswerEntry['answer']): Promise<AnswerEntry> {
    const entry = {
      id: `a${hashText(normalizeForMatch(question))}`,
      question,
      answer,
      updatedAt: this.now(),
    };
    const others = (await this.list()).filter((existing) => existing.id !== entry.id);
    await this.store.set(STORAGE_KEY, [...others, entry]);
    return entry;
  }

  async update(id: string, answer: string): Promise<AnswerEntry[]> {
    const entries = (await this.list()).map((entry) =>
      entry.id === id ? { ...entry, answer, updatedAt: this.now() } : entry,
    );
    await this.store.set(STORAGE_KEY, entries);
    return entries;
  }

  async remove(id: string): Promise<AnswerEntry[]> {
    const entries = (await this.list()).filter((entry) => entry.id !== id);
    await this.store.set(STORAGE_KEY, entries);
    return entries;
  }
}
