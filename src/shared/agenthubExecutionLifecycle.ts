export type TaskExecutionFormPhase = 'idle' | 'executing' | 'executed' | 'ambiguous' | 'failed';

export class InvalidExecutionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExecutionTransitionError';
  }
}

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
    if (this.#phase === 'ambiguous') {
      throw new InvalidExecutionTransitionError(
        'Normal Execute is not allowed while the previous execution outcome is ambiguous'
      );
    }
    if (this.#phase === 'executing') {
      throw new InvalidExecutionTransitionError('Execute is already in flight');
    }
    this.#phase = 'executing';
    return this.#id;
  }

  beginRetry(): string {
    if (this.#phase !== 'ambiguous') {
      throw new InvalidExecutionTransitionError(
        'Retry Same Execution is only allowed while the previous execution outcome is ambiguous'
      );
    }
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
