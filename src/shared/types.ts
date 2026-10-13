export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'textarea'
  | 'file'
  | 'combobox';

export type LabelSource =
  | 'label-for'
  | 'label-wrap'
  | 'aria-labelledby'
  | 'aria-label'
  | 'placeholder'
  | 'nearby-text'
  | 'group-legend'
  | 'name-attribute';

export interface FieldGroup {
  key: string;
  label: string;
  index: number;
}

export interface FieldSchema {
  id: string;
  frameId: number;
  origin: string;
  selector: string;
  type: FieldType;
  label: string;
  labelSource: LabelSource;
  required: boolean;
  value: string | string[] | boolean;
  options?: string[];
  placeholder?: string;
  group?: FieldGroup;
  /** Validation message the page is showing for this field. */
  error?: string;
}

export type ButtonKind = 'advance' | 'submit' | 'other';

export interface ButtonInfo {
  frameId: number;
  selector: string;
  text: string;
  kind: ButtonKind;
  disabled: boolean;
}

/** Resume sections that forms let the applicant repeat with an "Add" button. */
export type RepeatableKind = 'work' | 'education' | 'languages' | 'certificates';

export interface RepeatableSection {
  frameId: number;
  selector: string;
  text: string;
  /** Resume sections whose entries go here; more than one when a form mixes them. */
  kinds: RepeatableKind[];
  /** Blocks of this section already on the page. */
  existingBlocks: number;
}

/** What one frame of the tab reports about itself. */
export interface FrameSnapshot {
  origin: string;
  url: string;
  title?: string;
  fields: FieldSchema[];
  buttons: ButtonInfo[];
  repeatables: RepeatableSection[];
  /** Origins of visible iframes embedded in this frame. */
  iframeOrigins: string[];
}

/** The current step of the form, merged across every frame the extension can read. */
export interface StepSchema {
  signature: string;
  url: string;
  title?: string;
  fields: FieldSchema[];
  buttons: ButtonInfo[];
  repeatables: RepeatableSection[];
  /** Origins of embedded frames the extension has no access to yet. */
  blockedOrigins: string[];
}

export interface FieldDecision {
  fieldId: string;
  action: 'fill' | 'skip' | 'ask_user';
  value?: string | string[] | boolean;
  confidence: number;
  reason?: string;
  needsReview?: boolean;
  /** Where the value came from: a path in the resume ("basics.email") or "answers.<id>". */
  source?: string;
  origin?: 'llm' | 'cache' | 'user';
}

export interface FillResult {
  fieldId: string;
  status: 'filled' | 'failed' | 'pending_manual';
  error?: string;
}

export type AdvanceOutcome = 'advanced' | 'disabled' | 'unchanged' | 'refused';

/** File handed to the page for an upload field. */
export interface UploadFile {
  name: string;
  type: string;
  base64: string;
}

export type RunPhase =
  | 'IDLE'
  | 'EXTRACTING'
  | 'MAPPING'
  | 'FILLING'
  | 'VALIDATING'
  | 'WAITING_USER_REVIEW'
  | 'ADVANCING'
  | 'FINAL_REVIEW'
  | 'DONE'
  | 'ERROR';

export type RunErrorCode =
  | 'missing_api_key'
  | 'missing_resume'
  | 'injection_failed'
  | 'no_fields'
  | 'llm_auth'
  | 'llm_rate_limit'
  | 'llm_unavailable'
  | 'llm_network'
  | 'llm_refusal'
  | 'llm_invalid_response'
  | 'llm_bad_request'
  | 'unexpected';

export interface RunError {
  code: RunErrorCode;
  detail?: string;
}

/** Why the run could not move to the next step on its own. */
export type RunNotice =
  | { code: 'next_disabled'; missing: string[] }
  | { code: 'step_unchanged' }
  | { code: 'no_next_button' }
  | { code: 'page_reloaded' };

export interface BlockShortfall {
  /** Text of the "Add" button. */
  button: string;
  missing: number;
}

export interface RunState {
  tabId: number;
  /** Identifies the application (host and path where the run started), to resume it later. */
  key: string;
  phase: RunPhase;
  stepNumber: number;
  step?: StepSchema;
  /** Decisions of the current step, one per field. */
  decisions: FieldDecision[];
  results: FillResult[];
  /** Every decision taken in this application, by field id; survives reloads. */
  decided: Record<string, FieldDecision>;
  /** Times each field was filled, to cap automatic corrections. */
  attempts: Record<string, number>;
  /**
   * Blocks added per "Add" button (by its text) in the current reading of the step: a ceiling
   * for lists whose blocks cannot be counted on the page.
   */
  added: Record<string, number>;
  /** "Add" buttons that did not produce all the blocks the resume needs. */
  shortfalls?: BlockShortfall[];
  jobDescription?: string;
  notice?: RunNotice;
  error?: RunError;
  updatedAt: number;
}
