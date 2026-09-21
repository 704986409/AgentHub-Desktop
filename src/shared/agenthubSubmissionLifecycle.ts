export type TaskFormPhase = 'idle' | 'submitting' | 'created' | 'applied' | 'ambiguous' | 'failed';

export class InvalidSubmissionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSubmissionTransitionError';
  }
}

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
    if (this.#phase === 'ambiguous') {
      throw new InvalidSubmissionTransitionError(
        'Normal Submit is not allowed while the previous submission outcome is ambiguous'
      );
    }
    if (this.#phase === 'submitting') {
      throw new InvalidSubmissionTransitionError('Submit is already in flight');
    }
    this.#phase = 'submitting';
    return this.#id;
  }

  beginRetry(): string {
    if (this.#phase !== 'ambiguous') {
      throw new InvalidSubmissionTransitionError(
        'Retry Same Submission is only allowed while the previous submission outcome is ambiguous'
      );
    }
    this.#phase = 'submitting';
    return this.#id;
  }

  onResult(status: 'created' | 'applied' | 'ambiguous' | 'failed'): string {
    this.#phase = status;
    if (status !== 'ambiguous') {
      this.#id = this.#generateId();
    }
    return this.#id;
  }

  onEdit(): string {
    if (
      this.#phase === 'ambiguous' ||
      this.#phase === 'failed' ||
      this.#phase === 'created' ||
      this.#phase === 'applied'
    ) {
      this.#id = this.#generateId();
      this.#phase = 'idle';
    }
    return this.#id;
  }
}
