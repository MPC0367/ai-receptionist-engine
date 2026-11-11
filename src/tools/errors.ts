/** Typed tool errors (blueprint §9.2). `speakable_hint` is all the model ever learns about a failure. */
export type ErrorCode = 'NOT_FOUND' | 'AMBIGUOUS' | 'CONFLICT' | 'POLICY_BLOCKED' | 'CONSENT_REQUIRED' | 'CONNECTOR_UNAVAILABLE'
  | 'RATE_LIMITED' | 'AUTH_EXPIRED' | 'VALIDATION_FAILED' | 'HUMAN_REQUIRED' | 'VERSION_MISMATCH' | 'EXPIRED';
export type Hint = 'slot_taken' | 'no_availability' | 'need_more_detail' | 'not_allowed_by_policy' | 'cannot_text_number'
  | 'system_trouble' | 'needs_person' | 'try_again' | 'none';

const RETRYABLE: Record<ErrorCode, boolean> = {
  NOT_FOUND: false, AMBIGUOUS: false, CONFLICT: false, POLICY_BLOCKED: false, CONSENT_REQUIRED: false,
  CONNECTOR_UNAVAILABLE: true, RATE_LIMITED: true, AUTH_EXPIRED: false, VALIDATION_FAILED: false, HUMAN_REQUIRED: false,
  VERSION_MISMATCH: false, EXPIRED: false,
};
const DEFAULT_HINT: Record<ErrorCode, Hint> = {
  NOT_FOUND: 'need_more_detail', AMBIGUOUS: 'need_more_detail', CONFLICT: 'slot_taken', POLICY_BLOCKED: 'not_allowed_by_policy',
  CONSENT_REQUIRED: 'cannot_text_number', CONNECTOR_UNAVAILABLE: 'system_trouble', RATE_LIMITED: 'try_again',
  AUTH_EXPIRED: 'system_trouble', VALIDATION_FAILED: 'need_more_detail', HUMAN_REQUIRED: 'needs_person',
  VERSION_MISMATCH: 'try_again', EXPIRED: 'try_again',
};

export class ToolError extends Error {
  code: ErrorCode; hint: Hint;
  constructor(code: ErrorCode, internal: string, hint?: Hint) {
    super(internal);
    this.code = code;
    this.hint = hint ?? DEFAULT_HINT[code];
  }
  toResult() {
    return { ok: false as const, error: { code: this.code, retryable: RETRYABLE[this.code], speakable_hint: this.hint } };
  }
}
