export interface AnswerEntry {
  id: string;
  question: string;
  answer: string | string[];
  updatedAt: number;
}

export interface CacheSummary {
  domain: string;
  steps: number;
  fields: number;
}

export interface FileMeta {
  name: string;
  type: string;
  /** Size of the file in bytes. */
  size: number;
}
