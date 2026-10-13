import type {
  AdvanceOutcome,
  ButtonInfo,
  FieldDecision,
  FillResult,
  RepeatableSection,
  StepSchema,
  UploadFile,
} from '../shared/types';

/** What the orchestrator can do to a tab. Lets it be tested without a browser. */
export interface TabGateway {
  url(tabId: number): Promise<string>;
  /**
   * Reads the step on screen across every frame the extension can access. `settle` waits for
   * the page to stop changing first. Throws InjectionError without access to the tab.
   */
  extract(tabId: number, settle: boolean): Promise<StepSchema>;
  fill(
    tabId: number,
    step: StepSchema,
    decisions: readonly FieldDecision[],
    delayMs: number,
    file: UploadFile | null,
  ): Promise<FillResult[]>;
  advance(tabId: number, button: ButtonInfo): Promise<AdvanceOutcome>;
  addBlock(tabId: number, repeatable: RepeatableSection): Promise<boolean>;
}

export class InjectionError extends Error {}
