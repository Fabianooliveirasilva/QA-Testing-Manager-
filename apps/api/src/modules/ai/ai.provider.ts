import type { ZodType } from 'zod';

export interface AiCompletionRequest<T> {
  system: string;
  prompt: string;
  /** Response contract; providers must return data that satisfies it. */
  schema: ZodType<T>;
  maxTokens: number;
}

export interface AiCompletion<T> {
  data: T;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiErrorKind = 'refusal' | 'invalid_output' | 'rate_limited' | 'unavailable' | 'bad_request';

export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Provider-agnostic contract. Add a vendor by implementing this interface and wiring it in createAiProvider. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete<T>(request: AiCompletionRequest<T>): Promise<AiCompletion<T>>;
}
