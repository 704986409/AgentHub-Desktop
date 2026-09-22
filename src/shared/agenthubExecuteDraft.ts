export const DEFAULT_EXECUTE_BASE_REF = 'main';
export const EXECUTE_BASE_REF_MAX_CHARS = 256;
export const EXECUTE_PROMPT_MAX_CHARS = 20_000;

export const EXECUTE_VALIDATION_MESSAGE = Object.freeze({
  baseRefRequired: 'Base Ref 不能为空',
  promptRequired: 'Prompt 不能为空',
  baseRefTooLong: 'Base Ref 最多 256 个字符',
  promptTooLong: 'Prompt 最多 20000 个字符',
  planOwned: '该任务由计划生命周期自动调度，无需手动执行。'
});

export type ExecuteDraftResult =
  | { readonly ok: true; readonly baseRef: string; readonly prompt: string }
  | { readonly ok: false; readonly message: string };

export function validateExecuteDraft(baseRef: string, prompt: string): ExecuteDraftResult {
  const trimmedBaseRef = baseRef.trim();
  const trimmedPrompt = prompt.trim();
  if (trimmedBaseRef.length === 0) return { ok: false, message: EXECUTE_VALIDATION_MESSAGE.baseRefRequired };
  if (trimmedPrompt.length === 0) return { ok: false, message: EXECUTE_VALIDATION_MESSAGE.promptRequired };
  if (trimmedBaseRef.length > EXECUTE_BASE_REF_MAX_CHARS) {
    return { ok: false, message: EXECUTE_VALIDATION_MESSAGE.baseRefTooLong };
  }
  if (trimmedPrompt.length > EXECUTE_PROMPT_MAX_CHARS) {
    return { ok: false, message: EXECUTE_VALIDATION_MESSAGE.promptTooLong };
  }
  return { ok: true, baseRef: trimmedBaseRef, prompt: trimmedPrompt };
}

export function buildExecuteHttpBody(input: { readonly baseRef: string; readonly prompt: string }): {
  readonly baseRef: string;
  readonly prompt: string;
} {
  return {
    baseRef: input.baseRef.trim(),
    prompt: input.prompt.trim()
  };
}
