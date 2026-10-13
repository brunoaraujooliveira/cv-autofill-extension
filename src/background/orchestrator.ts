import type { AnswerEntry } from '../shared/answers';
import type { Logger } from '../shared/logger';
import type { Resume } from '../shared/resume';
import { BUSY_PHASES, transition, type RunEvent } from '../shared/run-machine';
import type { Settings } from '../shared/settings';
import { hasAdvanceButton, isEmptyValue, isFinalStep } from '../shared/step';
import { findOptionIndex, isFormatHint } from '../shared/text';
import type {
  BlockShortfall,
  ButtonInfo,
  FieldDecision,
  FieldSchema,
  FillResult,
  RepeatableSection,
  RunError,
  RunErrorCode,
  RunNotice,
  RunState,
  StepSchema,
  UploadFile,
} from '../shared/types';
import { LlmError, type LlmErrorKind } from './llm/client';
import type { LlmCredentials, Mapper } from './llm/mapper';
import type { AnswerBank } from './storage/answer-bank';
import type { MappingCache } from './storage/mapping-cache';
import type { ResumeFileRepository } from './storage/resume-file';
import type { ResumeRepository } from './storage/resume';
import type { SettingsRepository } from './storage/settings';
import { runKey, type StateStore } from './storage/state-store';
import { InjectionError, type TabGateway } from './tab-gateway';

export interface OrchestratorDependencies {
  settings: SettingsRepository;
  resume: ResumeRepository;
  resumeFile: ResumeFileRepository;
  answers: AnswerBank;
  cache: MappingCache;
  states: StateStore;
  mapper: Mapper;
  tabs: TabGateway;
  logger: Logger;
  onChange: (state: RunState) => void;
  now?: () => number;
}

export interface StartOptions {
  jobDescription?: string;
  /** Discards everything decided so far for this application. */
  fresh?: boolean;
  /**
   * Does the step on screen over: forgets what was decided and reported for it, empties the
   * text the extension had typed into it, and decides every field again without the cache.
   */
  redo?: boolean;
}

interface StepOptions {
  allowAutoAdvance: boolean;
  redo?: boolean;
}

/** Field types whose value is typed text, which can be emptied without choosing anything else. */
const TYPED_FIELDS: ReadonlySet<FieldSchema['type']> = new Set([
  'text',
  'email',
  'tel',
  'number',
  'date',
  'textarea',
  'combobox',
]);

type AnswerValue = NonNullable<FieldDecision['value']>;

/** Fills of one field before giving up on correcting it: the first try plus two corrections. */
const MAX_FILLS_PER_FIELD = 3;
/**
 * Safety limit on passes over one step. What really ends the passes is running out of work:
 * corrections are capped per field and blocks by the size of the resume. It has to exceed the
 * longest list a form may add one block per pass, or the last block would be left empty.
 */
const MAX_ROUNDS = 40;
const MAX_BLOCKS_PER_SECTION = 15;
const AUTO_ADVANCE_MIN_CONFIDENCE = 0.8;

const LLM_ERROR_CODES: Record<LlmErrorKind, RunErrorCode> = {
  auth: 'llm_auth',
  rate_limit: 'llm_rate_limit',
  unavailable: 'llm_unavailable',
  network: 'llm_network',
  refusal: 'llm_refusal',
  invalid_response: 'llm_invalid_response',
  bad_request: 'llm_bad_request',
};

/** Failure with a code the side panel knows how to explain. */
class RunFailure extends Error {
  constructor(readonly code: RunErrorCode) {
    super(code);
  }
}

function toRunError(error: unknown): RunError {
  if (error instanceof RunFailure) return { code: error.code };
  if (error instanceof InjectionError) return { code: 'injection_failed', detail: error.message };
  if (error instanceof LlmError)
    return { code: LLM_ERROR_CODES[error.kind], detail: error.message };
  return { code: 'unexpected', detail: error instanceof Error ? error.message : String(error) };
}

/** Everything about the applicant a step needs, loaded once per step. */
interface ApplicantContext {
  settings: Settings;
  credentials: LlmCredentials;
  resume: Resume;
  answers: AnswerEntry[];
  file: UploadFile | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A label that says what is asked, so an answer to it can be recognized on another form. */
function isRecognizableLabel(label: string): boolean {
  return label.trim() !== '' && !isFormatHint(label);
}

function askUser(fieldId: string, reason: string): FieldDecision {
  return { fieldId, action: 'ask_user', confidence: 0, reason };
}

/** Whether the page lost a value that was filled before (after a reload, for instance). */
function needsRefill(field: FieldSchema, decision: FieldDecision): boolean {
  if (decision.action !== 'fill' || field.error) return false;
  return typeof decision.value === 'boolean'
    ? field.value !== decision.value
    : isEmptyValue(field.value);
}

function canAutoAdvance(state: RunState): boolean {
  const decisionsAreSafe = state.decisions.every(
    (decision) =>
      decision.action === 'skip' ||
      (decision.action === 'fill' &&
        !decision.needsReview &&
        decision.confidence >= AUTO_ADVANCE_MIN_CONFIDENCE),
  );
  return (
    decisionsAreSafe &&
    state.results.every((result) => result.status === 'filled') &&
    state.step?.blockedOrigins.length === 0 &&
    !state.notice
  );
}

/**
 * Drives an application one step at a time: read the step, decide each field, fill, check the
 * result, wait for the user, move on. It stops for good at the step whose way forward is a
 * submit button; that click is never the extension's.
 */
export class Orchestrator {
  private readonly states = new Map<number, RunState>();
  private readonly running = new Map<number, Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly deps: OrchestratorDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async get(tabId: number): Promise<RunState | null> {
    return this.states.get(tabId) ?? (await this.deps.states.loadByTab(tabId));
  }

  /** Reads and fills the step on screen, resuming the application if it was seen before. */
  async start(tabId: number, options: StartOptions = {}): Promise<RunState> {
    const current = await this.get(tabId);
    if (current && BUSY_PHASES.has(current.phase) && this.running.has(tabId)) return current;

    const url = await this.deps.tabs.url(tabId).catch(() => '');
    // Without an address to go by, the run can only be told apart by its tab.
    const key = url ? runKey(url) : `tab:${tabId}`;
    const known = current ?? (await this.deps.states.loadByKey(key));
    const base: RunState =
      known && !options.fresh
        ? { ...known, tabId }
        : {
            tabId,
            key,
            phase: 'IDLE',
            stepNumber: 1,
            decisions: [],
            results: [],
            decided: {},
            attempts: {},
            added: {},
            updatedAt: 0,
          };
    const { notice: _notice, error: _error, ...clean } = base;
    const jobDescription = options.jobDescription?.trim() || clean.jobDescription;

    const state = this.publish({
      ...clean,
      phase: 'EXTRACTING',
      results: [],
      // Counted per reading of a step: blocks may have been deleted or the page reloaded since.
      added: {},
      ...(jobDescription ? { jobDescription } : {}),
    });
    const redo = options.redo === true && !options.fresh;
    this.launch(tabId, () => this.processStep(tabId, { allowAutoAdvance: true, redo }));
    return state;
  }

  /** The user reviewed the step: remember it and move to the next one. */
  async confirm(tabId: number): Promise<RunState> {
    this.move(await this.loaded(tabId), 'CONFIRM');
    this.launch(tabId, () => this.advance(tabId, true));
    return this.current(tabId);
  }

  /** Fills a field with what the user typed in the side panel and keeps the answer for next time. */
  async answer(tabId: number, fieldId: string, value: AnswerValue): Promise<RunState> {
    const state = await this.loaded(tabId);
    const field = state.step?.fields.find((candidate) => candidate.id === fieldId);
    if (!field || !state.step) throw new Error('Unknown field');
    if (BUSY_PHASES.has(state.phase)) throw new Error('The run is busy');
    if (!isValidAnswer(field, value)) throw new Error('That value does not fit the field');

    // Consent boxes and uploads are answered per form; everything else is worth remembering.
    const reusable =
      field.type !== 'checkbox' &&
      field.type !== 'file' &&
      typeof value !== 'boolean' &&
      isRecognizableLabel(field.label);
    const entry = reusable ? await this.deps.answers.remember(field.label, value) : null;
    const decision: FieldDecision = {
      fieldId,
      action: 'fill',
      value,
      confidence: 1,
      origin: 'user',
      ...(entry ? { source: `answers.${entry.id}` } : {}),
    };
    const { settings, file } = await this.loadContext();
    const results = await this.deps.tabs.fill(
      tabId,
      state.step,
      [decision],
      settings.fillDelayMs,
      file,
    );
    return this.record(tabId, [decision], results);
  }

  /** The user is done with the final review; what was learnt on the last step is kept. */
  async finish(tabId: number): Promise<RunState> {
    const state = await this.loaded(tabId);
    transition(state.phase, 'FINISH');
    await this.rememberStep(state);
    return this.move(state, 'FINISH');
  }

  /** The tab loaded a new document outside a run: the filled values may be gone. */
  async onTabReloaded(tabId: number): Promise<void> {
    const state = await this.get(tabId);
    if (!state || BUSY_PHASES.has(state.phase)) return;
    if (state.phase !== 'WAITING_USER_REVIEW' && state.phase !== 'FINAL_REVIEW') return;
    this.publish({ ...state, notice: { code: 'page_reloaded' } });
  }

  async onTabClosed(tabId: number): Promise<void> {
    this.states.delete(tabId);
    await this.deps.states.detachTabs(tabId);
  }

  /** Resolves when the run of a tab stops making progress on its own. */
  whenSettled(tabId: number): Promise<void> {
    return this.running.get(tabId) ?? Promise.resolve();
  }

  // --- one step -------------------------------------------------------------------------------

  private async processStep(tabId: number, options: StepOptions): Promise<void> {
    const { allowAutoAdvance, redo = false } = options;
    const context = await this.loadContext();
    const onScreen = await this.deps.tabs.extract(tabId, false);
    let step = await this.expandRepeatables(
      tabId,
      redo ? await this.forgetStep(tabId, onScreen, context) : onScreen,
      context,
    );

    if (step.fields.length === 0) {
      if (isFinalStep(step)) this.move(this.current(tabId), 'FINAL_STEP', { step, decisions: [] });
      else if (hasAdvanceButton(step))
        this.move(this.current(tabId), 'NOTHING_TO_FILL', { step, decisions: [] });
      else throw new RunFailure('no_fields');
      return;
    }

    this.move(this.current(tabId), 'FIELDS_FOUND', { step });
    for (let round = 1; ; round += 1) {
      const toFill = await this.decide(tabId, step, context, !redo);
      this.move(this.current(tabId), 'MAPPED');

      const filled = toFill.length
        ? await this.deps.tabs.fill(tabId, step, toFill, context.settings.fillDelayMs, context.file)
        : [];
      this.record(tabId, [], filled);
      this.move(this.current(tabId), 'FILLED');

      step = await this.deps.tabs.extract(tabId, true);
      this.publish({ ...this.current(tabId), step });
      // Some forms only offer "Add" once the block before it is filled in, and until then show
      // the button disabled or not at all: look for it again after every pass that filled something.
      if (filled.length > 0) step = await this.expandRepeatables(tabId, step, context);
      if (round >= MAX_ROUNDS || !this.needsAnotherRound(tabId, step)) break;
      this.move(this.current(tabId), 'NEEDS_ANOTHER_ROUND');
    }

    this.giveUpOnRejectedFields(tabId, step);
    const state = this.move(this.current(tabId), isFinalStep(step) ? 'FINAL_STEP' : 'STEP_READY', {
      decisions: this.decisionsFor(tabId, step),
    });

    if (
      allowAutoAdvance &&
      context.settings.autoAdvance &&
      state.phase === 'WAITING_USER_REVIEW' &&
      canAutoAdvance(state)
    ) {
      this.move(state, 'CONFIRM');
      await this.advance(tabId, true);
    }
  }

  /**
   * Wipes the slate for the step on screen: drops its decisions, results and correction counts,
   * and empties the text fields the extension itself had filled, so a value it got wrong does
   * not linger. What the user typed, on the page or in the panel, is left where it is.
   */
  private async forgetStep(
    tabId: number,
    step: StepSchema,
    context: ApplicantContext,
  ): Promise<StepSchema> {
    const state = this.current(tabId);
    const ownText = step.fields.filter((field) => {
      const prior = state.decided[field.id];
      const typedByExtension = prior?.action === 'fill' && prior.origin !== 'user';
      return typedByExtension && TYPED_FIELDS.has(field.type) && !isEmptyValue(field.value);
    });

    const onStep = new Set(step.fields.map((field) => field.id));
    const keep = <T>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([fieldId]) => !onStep.has(fieldId)));
    this.publish({
      ...state,
      decided: keep(state.decided),
      attempts: keep(state.attempts),
      decisions: [],
      results: [],
    });

    if (ownText.length === 0) return step;
    const emptied = ownText.map((field): FieldDecision => ({
      fieldId: field.id,
      action: 'fill',
      value: '',
      confidence: 0,
    }));
    await this.deps.tabs.fill(tabId, step, emptied, context.settings.fillDelayMs, null);
    return this.deps.tabs.extract(tabId, true);
  }

  /**
   * Clicks each "Add" button until its list has one block per resume entry. The page is read
   * again after every list, because adding blocks moves the buttons that come after them.
   */
  private async expandRepeatables(
    tabId: number,
    step: StepSchema,
    context: ApplicantContext,
  ): Promise<StepSchema> {
    const handled = new Set<string>();
    const shortfalls: BlockShortfall[] = [];
    let current = step;

    for (;;) {
      const repeatable = current.repeatables.find((candidate) => !handled.has(candidate.text));
      if (!repeatable) break;
      handled.add(repeatable.text);

      const missing = this.missingBlocks(tabId, repeatable, context.resume);
      let added = 0;
      while (added < missing && (await this.deps.tabs.addBlock(tabId, repeatable))) added += 1;
      if (added < missing) shortfalls.push({ button: repeatable.text, missing: missing - added });
      if (added === 0) continue;

      current = await this.deps.tabs.extract(tabId, true);
      const state = this.current(tabId);
      const addedBefore = state.added[repeatable.text] ?? 0;
      this.publish({ ...state, added: { ...state.added, [repeatable.text]: addedBefore + added } });
    }

    const { shortfalls: _previous, ...state } = this.current(tabId);
    this.publish({ ...state, step: current, ...(shortfalls.length > 0 ? { shortfalls } : {}) });
    return current;
  }

  private missingBlocks(tabId: number, repeatable: RepeatableSection, resume: Resume): number {
    const sections = resume as Record<string, unknown>;
    const entryCount = repeatable.kinds
      .map((kind) => sections[kind])
      .reduce<number>((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
    const wanted = Math.min(entryCount, MAX_BLOCKS_PER_SECTION);
    // The page's own count decides. What this reading of the step already added is only a
    // ceiling, so a list that cannot be counted still stops at the size of the resume.
    const addedThisReading = this.current(tabId).added[repeatable.text] ?? 0;
    return Math.min(wanted - repeatable.existingBlocks, wanted - addedThisReading);
  }

  /**
   * Settles what goes into each field of the step: remembered decisions first, then the cache,
   * then the model. Returns the decisions that still have to be applied to the page.
   */
  private async decide(
    tabId: number,
    step: StepSchema,
    context: ApplicantContext,
    useCache: boolean,
  ): Promise<FieldDecision[]> {
    const state = this.current(tabId);
    const filledNow = new Set(state.results.map((result) => result.fieldId));
    const undecided: FieldSchema[] = [];
    const toFill: FieldDecision[] = [];

    for (const field of step.fields) {
      const prior = state.decided[field.id];
      if (!prior) undecided.push(field);
      else if (this.shouldCorrect(state, field, prior)) undecided.push(field);
      else if (!filledNow.has(field.id) && needsRefill(field, prior)) toFill.push(prior);
    }
    if (undecided.length === 0) return toFill;

    const data = { resume: context.resume, answers: context.answers };
    const cached = useCache
      ? await this.deps.cache.lookup(hostOf(step.url), step.signature, undecided, data)
      : [];
    const cachedIds = new Set(cached.map((decision) => decision.fieldId));
    const forModel = undecided.filter((field) => !cachedIds.has(field.id));
    const mapped = forModel.length
      ? await this.deps.mapper.map(
          {
            fields: forModel,
            ...data,
            ...(state.jobDescription ? { jobDescription: state.jobDescription } : {}),
          },
          context.credentials,
        )
      : [];

    const fresh = [...cached, ...mapped];
    this.record(tabId, fresh, []);
    return [...toFill, ...fresh.filter((decision) => decision.action === 'fill')];
  }

  /** A field the page rejected is decided again, with the error, a limited number of times. */
  private shouldCorrect(state: RunState, field: FieldSchema, prior: FieldDecision): boolean {
    return (
      field.error !== undefined &&
      prior.action === 'fill' &&
      prior.origin !== 'user' &&
      (state.attempts[field.id] ?? 0) < MAX_FILLS_PER_FIELD
    );
  }

  private needsAnotherRound(tabId: number, step: StepSchema): boolean {
    const state = this.current(tabId);
    const touched = new Set(state.results.map((result) => result.fieldId));
    return step.fields.some((field) => {
      const prior = state.decided[field.id];
      if (!prior || this.shouldCorrect(state, field, prior)) return true;
      // A block added just now can reuse the identity of one decided on an earlier reading:
      // it is decided already, but still empty on the page.
      return !touched.has(field.id) && needsRefill(field, prior);
    });
  }

  /** Fields still rejected after every correction are handed to the user with the page's message. */
  private giveUpOnRejectedFields(tabId: number, step: StepSchema): void {
    const state = this.current(tabId);
    const rejected = step.fields.filter(
      (field) =>
        field.error &&
        state.decided[field.id]?.action === 'fill' &&
        state.decided[field.id]?.origin !== 'user',
    );
    if (rejected.length === 0) return;
    this.record(
      tabId,
      rejected.map((field) => askUser(field.id, field.error ?? '')),
      rejected.map((field) => ({
        fieldId: field.id,
        status: 'failed' as const,
        error: field.error ?? '',
      })),
    );
  }

  // --- moving between steps -------------------------------------------------------------------

  private async advance(tabId: number, mayRecheck: boolean): Promise<void> {
    const state = this.current(tabId);
    const step = state.step;
    if (!step) throw new Error('No step to advance from');
    await this.rememberStep(state);

    const button = await this.pickAdvanceButton(step);
    if (!button) {
      if (isFinalStep(step)) this.move(state, 'FINAL_STEP');
      else this.move(state, 'STUCK', { notice: { code: 'no_next_button' } });
      return;
    }

    const outcome = await this.deps.tabs.advance(tabId, button);
    if (outcome === 'refused') {
      this.move(state, 'FINAL_STEP');
    } else if (outcome === 'advanced') {
      this.move(state, 'STEP_CHANGED', {
        stepNumber: state.stepNumber + 1,
        decisions: [],
        results: [],
        added: {},
      });
      await this.processStep(tabId, { allowAutoAdvance: true });
    } else if (mayRecheck) {
      await this.recheckBlockedStep(tabId, outcome);
    } else {
      this.move(state, 'STUCK', { notice: this.blockedNotice(step, outcome) });
    }
  }

  /**
   * The step did not move: read it again (filling may have revealed new fields or errors) and
   * try once more if that changed anything. Otherwise tell the user what seems to be missing.
   */
  private async recheckBlockedStep(
    tabId: number,
    outcome: 'disabled' | 'unchanged',
  ): Promise<void> {
    this.move(this.current(tabId), 'RECHECK', { results: [] });
    await this.processStep(tabId, { allowAutoAdvance: false });

    const state = this.current(tabId);
    if (state.phase !== 'WAITING_USER_REVIEW' || !state.step) return;
    if (state.results.some((result) => result.status === 'filled')) {
      this.move(state, 'CONFIRM');
      await this.advance(tabId, false);
    } else {
      this.publish({ ...state, notice: this.blockedNotice(state.step, outcome) });
    }
  }

  private blockedNotice(step: StepSchema, outcome: 'disabled' | 'unchanged'): RunNotice {
    const missing = step.fields
      .filter((field) => field.error || (field.required && isEmptyValue(field.value)))
      .map((field) => field.label);
    return outcome === 'disabled' || missing.length > 0
      ? { code: 'next_disabled', missing }
      : { code: 'step_unchanged' };
  }

  /** The button to click: the obvious one, or the model's pick when the texts do not settle it. */
  private async pickAdvanceButton(step: StepSchema): Promise<ButtonInfo | null> {
    const advance = step.buttons.filter((button) => button.kind === 'advance');
    if (advance.length === 1) return advance[0] ?? null;

    // Buttons that may submit are never offered as candidates.
    const hasSubmit = step.buttons.some((button) => button.kind === 'submit');
    const candidates =
      advance.length > 1
        ? advance
        : hasSubmit
          ? []
          : step.buttons.filter((button) => button.kind === 'other');
    if (candidates.length === 0) return null;
    const { credentials } = await this.loadContext();
    return this.deps.mapper.chooseAdvanceButton(candidates, credentials);
  }

  private async rememberStep(state: RunState): Promise<void> {
    if (!state.step) return;
    const { resume, answers } = await this.loadContext();
    const notApplied = new Set(
      state.results.filter((result) => result.status !== 'filled').map((result) => result.fieldId),
    );
    const decisions = state.decisions.filter((decision) => !notApplied.has(decision.fieldId));
    await this.deps.cache.save(
      hostOf(state.step.url),
      state.step.signature,
      state.step.fields,
      decisions,
      { resume, answers },
    );
  }

  // --- state ----------------------------------------------------------------------------------

  private async loadContext(): Promise<ApplicantContext> {
    const settings = await this.deps.settings.load();
    if (settings.apiKey === '') throw new RunFailure('missing_api_key');
    const resume = await this.deps.resume.load();
    if (!resume) throw new RunFailure('missing_resume');
    return {
      settings,
      credentials: { apiKey: settings.apiKey, model: settings.model },
      resume,
      answers: await this.deps.answers.list(),
      file: await this.deps.resumeFile.load(),
    };
  }

  private launch(tabId: number, task: () => Promise<void>): void {
    const run = task()
      .catch((error: unknown) => {
        const runError = toRunError(error);
        this.deps.logger.error('Run failed', runError);
        this.publish({ ...this.current(tabId), phase: 'ERROR', error: runError });
      })
      .finally(() => this.running.delete(tabId));
    this.running.set(tabId, run);
  }

  /** Adds decisions and fill results to the run, keeping the per-step view in sync. */
  private record(
    tabId: number,
    decisions: readonly FieldDecision[],
    results: readonly FillResult[],
  ): RunState {
    const state = this.current(tabId);
    const decided = { ...state.decided };
    for (const decision of decisions) decided[decision.fieldId] = decision;
    const attempts = { ...state.attempts };
    for (const result of results) attempts[result.fieldId] = (attempts[result.fieldId] ?? 0) + 1;
    const touched = new Set(results.map((result) => result.fieldId));

    return this.publish({
      ...state,
      decided,
      attempts,
      results: [...state.results.filter((result) => !touched.has(result.fieldId)), ...results],
      decisions: state.step ? this.decisionsOf(decided, state.step) : state.decisions,
    });
  }

  private decisionsFor(tabId: number, step: StepSchema): FieldDecision[] {
    return this.decisionsOf(this.current(tabId).decided, step);
  }

  private decisionsOf(decided: RunState['decided'], step: StepSchema): FieldDecision[] {
    return step.fields
      .map((field) => decided[field.id])
      .filter((decision) => decision !== undefined);
  }

  private move(state: RunState, event: RunEvent, patch: Partial<RunState> = {}): RunState {
    const { notice: _notice, ...rest } = state;
    return this.publish({ ...rest, ...patch, phase: transition(state.phase, event) });
  }

  private current(tabId: number): RunState {
    const state = this.states.get(tabId);
    if (!state) throw new Error(`No run for tab ${tabId}`);
    return state;
  }

  /** The run of a tab, restored from storage when the service worker has just woken up. */
  private async loaded(tabId: number): Promise<RunState> {
    const state = await this.get(tabId);
    if (!state) throw new Error(`No run for tab ${tabId}`);
    this.states.set(tabId, state);
    return state;
  }

  private publish(state: RunState): RunState {
    const stamped = { ...state, updatedAt: this.now() };
    this.states.set(stamped.tabId, stamped);
    // A finished application is forgotten, so visiting the page again starts clean.
    const persisted =
      stamped.phase === 'DONE'
        ? this.deps.states.remove(stamped.key)
        : this.deps.states.save(stamped);
    persisted.catch((error: unknown) => {
      this.deps.logger.warn('Could not persist the run', error);
    });
    this.deps.onChange(stamped);
    return stamped;
  }
}

/** Checks a value typed in the side panel against what the field can take. */
export function isValidAnswer(field: FieldSchema, value: AnswerValue): boolean {
  if (field.type === 'checkbox') return typeof value === 'boolean';
  if (typeof value === 'boolean') return false;
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => item.trim() === '')) return false;
  return (
    !field.options?.length ||
    values.every((item) => findOptionIndex(field.options ?? [], item) !== -1)
  );
}
