export type TaskExecutionFormPhase = 'idle' | 'executing' | 'executed' | 'ambiguous' | 'failed';

/**
 * Renderer-owned logical execution ID lifecycle.
 * Main still derives the backend Idempotency-Key; this only decides which ID the UI sends.
 */
export class TaskExecutionIdLifecycle {
  #id: string;
  #phase: TaskExecutionFormPhase = 'idle';
  readonly #generateId: () => string;

  constructor(generateId: () => string = () => crypto.randomUUID()) {
    this.#generateId = generateId;
    this.#id = generateId();
  }

  get id(): string {
    return this.#id;
  }

  get phase(): TaskExecutionFormPhase {
    return this.#phase;
  }

  beginExecute(): string {
    this.#phase = 'executing';
    return this.#id;
  }

  beginRetry(): string {
    this.#phase = 'executing';
    return this.#id;
  }

  onResult(status: 'executed' | 'ambiguous' | 'failed'): string {
    this.#phase = status;
    if (status !== 'ambiguous') {
      this.#id = this.#generateId();
    }
    return this.#id;
  }

  onEdit(): string {
    if (this.#phase === 'ambiguous' || this.#phase === 'failed' || this.#phase === 'executed') {
      this.#id = this.#generateId();
      this.#phase = 'idle';
    }
    return this.#id;
  }
}
