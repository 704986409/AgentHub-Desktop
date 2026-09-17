export type TaskFormPhase = 'idle' | 'submitting' | 'created' | 'ambiguous' | 'failed';

/**
 * Renderer-owned logical submission ID lifecycle.
 * Main still derives the backend Idempotency-Key; this only decides which ID the UI sends.
 */
export class TaskSubmissionIdLifecycle {
  #id: string;
  #phase: TaskFormPhase = 'idle';
  readonly #generateId: () => string;

  constructor(generateId: () => string = () => crypto.randomUUID()) {
    this.#generateId = generateId;
    this.#id = generateId();
  }

  get id(): string {
    return this.#id;
  }

  get phase(): TaskFormPhase {
    return this.#phase;
  }

  beginSubmit(): string {
    this.#phase = 'submitting';
    return this.#id;
  }

  beginRetry(): string {
    this.#phase = 'submitting';
    return this.#id;
  }

  onResult(status: 'created' | 'ambiguous' | 'failed'): string {
    this.#phase = status;
    if (status !== 'ambiguous') {
      this.#id = this.#generateId();
    }
    return this.#id;
  }

  onEdit(): string {
    if (this.#phase === 'ambiguous' || this.#phase === 'failed' || this.#phase === 'created') {
      this.#id = this.#generateId();
      this.#phase = 'idle';
    }
    return this.#id;
  }
}
