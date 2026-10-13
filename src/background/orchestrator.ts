import type { AnswerEntry } from '../shared/answers';
import type { Logger } from '../shared/logger';
import type { Resume } from '../shared/resume';
import { BUSY_PHASES, transition, type RunEvent } from '../shared/run-machine';
import type { Settings } from '../shared/settings';
import { askUser, hasAdvanceButton, isEmptyValue, isFinalStep } from '../shared/step';
import { isNamingLabel } from '../shared/text';
import type {
  BlockShortfall,
  ButtonInfo,
  FieldDecision,
  FieldSchema,
  FieldValue,
  FillResult,
  RepeatableSection,
  RunNotice,
  RunState,
  StepSchema,
  UploadFile,
} from '../shared/types';
import type { LlmCredentials, Mapper } from './llm/mapper';
import type { AnswerBank } from './storage/answer-bank';
import type { MappingCache } from './storage/mapping-cache';
import type { ResumeFileRepository } from './storage/resume-file';
import type { ResumeRepository } from './storage/resume';
import type { SettingsRepository } from './storage/settings';
import {
  canAutoAdvance,
  hideApplicantText,
  holdsTypedText,
  hostOf,
  isValidAnswer,
  MAX_FILLS_PER_FIELD,
  needsRefill,
  RunCancelled,
  RunFailure,
  toRunError,
  wasFilledByExtension,
} from './run-rules';
import { runKey, type StateStore } from './storage/state-store';
import type { TabGateway } from './tab-gateway';

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
  /** Keeps the service worker from being put to sleep while a run works; returns how to stop. */
  keepAwake?: () => () => void;
  /** Gives back the access to other sites that was granted for embedded frames. */
  revokeSiteAccess?: () => Promise<void>;
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
  /** Steps the run may still leave on its own before it has to stop for the user. */
  autoSteps?: number;
}

/**
 * Safety limit on passes over one step. What really ends the passes is running out of work:
 * corrections are capped per field and blocks by the size of the resume. It has to exceed the
 * longest list a form may add one block per pass, or the last block would be left empty.
 */
const MAX_ROUNDS = 40;
const MAX_BLOCKS_PER_SECTION = 15;
/** Steps one run may walk through unattended. A form that never ends cannot spend without limit. */
const MAX_AUTO_STEPS = 20;

/** Everything about the applicant a step needs, loaded once per step. */
interface ApplicantContext {
  settings: Settings;
  credentials: LlmCredentials;
  resume: Resume;
  answers: AnswerEntry[];
  file: UploadFile | null;
}

/**
 * Drives an application one step at a time: read the step, decide each field, fill, check the
 * result, wait for the user, move on. It stops for good at the step whose way forward is a
 * submit button; that click is never the extension's.
 */
export class Orchestrator {
  private readonly states = new Map<number, RunState>();
  private readonly running = new Map<number, Promise<void>>();
  private readonly cancelling = new Set<number>();
  private readonly now: () => number;

  constructor(private readonly deps: OrchestratorDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async get(tabId: number): Promise<RunState | null> {
    const live = this.states.get(tabId);
    if (live) return live;
    const stored = await this.deps.states.loadByTab(tabId);
    // Stored as working but nothing is running: the service worker was restarted mid-run.
    return stored && BUSY_PHASES.has(stored.phase)
      ? { ...stored, phase: 'ERROR', error: { code: 'interrupted' } }
      : stored;
  }

  /** Reads and fills the step on screen, resuming the application if it was seen before. */
  async start(tabId: number, options: StartOptions = {}): Promise<RunState> {
    const current = await this.get(tabId);
    if (current && BUSY_PHASES.has(current.phase) && this.running.has(tabId)) return current;

    const url = await this.deps.tabs.url(tabId).catch(() => '');
    // Without an address to go by, the run can only be told apart by its tab.
    const key = url ? runKey(url) : `tab:${tabId}`;
    // The tab's run only carries on if the tab is still on that application: where it started,
    // or the step it read last. Anything else is another application and starts from nothing.
    const sameApplication =
      current !== null &&
      (current.key === key || (current.step !== undefined && runKey(current.step.url) === key));
    const known = sameApplication ? current : await this.deps.states.loadByKey(key);
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
    this.launch(tabId, () =>
      this.processStep(tabId, { allowAutoAdvance: true, redo, autoSteps: MAX_AUTO_STEPS }),
    );
    return state;
  }

  /** The user reviewed the step: remember it and move to the next one. */
  async confirm(tabId: number): Promise<RunState> {
    this.move(await this.loaded(tabId), 'CONFIRM');
    this.launch(tabId, () => this.advance(tabId, MAX_AUTO_STEPS));
    return this.current(tabId);
  }

  /** Stops a run at its next checkpoint, leaving the page as it is for the user to review. */
  async cancel(tabId: number): Promise<RunState | null> {
    if (!this.running.has(tabId)) return this.get(tabId);
    this.cancelling.add(tabId);
    await this.deps.tabs.cancel(tabId);
    return this.get(tabId);
  }

  /** Fills a field with what the user typed in the side panel and keeps the answer for next time. */
  async answer(tabId: number, fieldId: string, value: FieldValue): Promise<RunState> {
    const state = await this.loaded(tabId);
    const field = state.step?.fields.find((candidate) => candidate.id === fieldId);
    if (!field || !state.step) throw new Error('Unknown field');
    if (BUSY_PHASES.has(state.phase) || this.running.has(tabId)) throw new Error('The run is busy');
    if (!isValidAnswer(field, value)) throw new Error('That value does not fit the field');

    // Consent boxes and uploads are answered per form; everything else is worth remembering.
    const reusable =
      field.type !== 'checkbox' &&
      field.type !== 'file' &&
      typeof value !== 'boolean' &&
      isNamingLabel(field.label);
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
    await this.deps.revokeSiteAccess?.();
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
    this.cancelling.add(tabId);
    await this.deps.states.detachTabs(tabId);
    await this.deps.revokeSiteAccess?.();
  }

  /** Resolves when the run of a tab stops making progress on its own. */
  whenSettled(tabId: number): Promise<void> {
    return this.running.get(tabId) ?? Promise.resolve();
  }

  // --- one step -------------------------------------------------------------------------------

  private async processStep(tabId: number, options: StepOptions): Promise<void> {
    const { allowAutoAdvance, redo = false, autoSteps = 0 } = options;
    this.checkpoint(tabId);
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
      this.checkpoint(tabId);
      const toFill = await this.decide(tabId, step, context, !redo);
      this.move(this.current(tabId), 'MAPPED');
      this.checkpoint(tabId);

      const filled = toFill.length
        ? await this.deps.tabs.fill(tabId, step, toFill, context.settings.fillDelayMs, context.file)
        : [];
      this.record(tabId, [], filled);
      this.checkpoint(tabId);
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

    const mayLeaveUnattended =
      allowAutoAdvance &&
      context.settings.autoAdvance &&
      state.phase === 'WAITING_USER_REVIEW' &&
      canAutoAdvance(state);
    if (!mayLeaveUnattended) return;
    if (autoSteps <= 0) {
      this.publish({ ...state, notice: { code: 'auto_limit' } });
      return;
    }
    this.move(state, 'CONFIRM');
    await this.advance(tabId, autoSteps - 1);
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
      const typedByExtension = wasFilledByExtension(state.decided[field.id]);
      return typedByExtension && holdsTypedText(field) && !isEmptyValue(field.value);
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
            fields: hideApplicantText(forModel, state.decided),
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

  private async advance(tabId: number, autoSteps: number): Promise<void> {
    this.checkpoint(tabId);
    const state = this.current(tabId);
    const step = state.step;
    if (!step) throw new Error('No step to advance from');
    await this.rememberStep(state);

    const button = isFinalStep(step) ? null : await this.pickAdvanceButton(step);
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
      await this.processStep(tabId, { allowAutoAdvance: true, autoSteps });
    } else {
      await this.recheckBlockedStep(tabId, outcome);
    }
  }

  /**
   * The step did not move: read it again, since filling may have revealed new fields or errors.
   * Whatever that fills is new to the user, so the run stops for review instead of clicking
   * again; when nothing changed, it says what seems to be missing.
   */
  private async recheckBlockedStep(
    tabId: number,
    outcome: 'disabled' | 'unchanged',
  ): Promise<void> {
    this.move(this.current(tabId), 'RECHECK', { results: [] });
    await this.processStep(tabId, { allowAutoAdvance: false });

    const state = this.current(tabId);
    if (state.phase !== 'WAITING_USER_REVIEW' || !state.step) return;
    const filledSomethingNew = state.results.some((result) => result.status === 'filled');
    this.publish({
      ...state,
      notice: filledSomethingNew
        ? { code: 'review_new_fields' }
        : this.blockedNotice(state.step, outcome),
    });
  }

  private blockedNotice(step: StepSchema, outcome: 'disabled' | 'unchanged'): RunNotice {
    const missing = step.fields
      .filter((field) => field.error || (field.required && isEmptyValue(field.value)))
      .map((field) => field.label);
    return outcome === 'disabled' || missing.length > 0
      ? { code: 'next_disabled', missing }
      : { code: 'step_unchanged' };
  }

  /**
   * The button to click. Only buttons whose own text says "next" are candidates; when there
   * are several, the model picks among those. A button of unknown purpose is never clicked,
   * whoever suggests it: without a recognisable "next", the user moves on by hand.
   */
  private async pickAdvanceButton(step: StepSchema): Promise<ButtonInfo | null> {
    const candidates = step.buttons.filter((button) => button.kind === 'advance');
    if (candidates.length <= 1) return candidates[0] ?? null;
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
    this.cancelling.delete(tabId);
    const stopKeepingAwake = this.deps.keepAwake?.();
    const run = task()
      .catch((error: unknown) => {
        const state = this.states.get(tabId);
        // The tab is gone, and its run with it: there is nobody left to tell.
        if (!state) return;
        if (error instanceof RunCancelled) {
          this.move(state, 'CANCEL', { notice: { code: 'cancelled' } });
          return;
        }
        const runError = toRunError(error);
        this.deps.logger.error('Run failed', runError);
        this.publish({ ...state, phase: 'ERROR', error: runError });
      })
      .finally(() => {
        stopKeepingAwake?.();
        this.cancelling.delete(tabId);
        this.running.delete(tabId);
      });
    this.running.set(tabId, run);
  }

  /** Where a run stops if the user asked it to. Placed before each thing that costs or changes. */
  private checkpoint(tabId: number): void {
    if (this.cancelling.has(tabId)) throw new RunCancelled();
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
