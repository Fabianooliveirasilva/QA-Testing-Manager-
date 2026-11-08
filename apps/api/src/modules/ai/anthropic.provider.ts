import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AiCompletion, AiCompletionRequest, AiProvider } from './ai.provider.js';
import { AiProviderError } from './ai.provider.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** Claude adapter using the official SDK with structured outputs (output_config.format). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    /** Test hook: point the official SDK at a local stub of the API. */
    clientOptions: { baseURL?: string; timeout?: number } = {},
  ) {
    // Worst case (timeout × (1 + retries)) must stay below the reverse-proxy read timeout (180 s).
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1, ...clientOptions });
  }

  async complete<T>(request: AiCompletionRequest<T>): Promise<AiCompletion<T>> {
    try {
      // messages.create (not .parse): stop_reason must be inspected before any JSON parsing,
      // otherwise refusals and truncated answers surface as generic SDK parse errors.
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: { effort: 'medium', format: zodOutputFormat(request.schema) },
      });
      if (response.stop_reason === 'refusal') {
        throw new AiProviderError('refusal', 'The AI provider declined this request');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiProviderError('invalid_output', 'The AI response was truncated; try a shorter input');
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiProviderError('invalid_output', 'The AI response was not valid JSON');
      }
      // The schema is the contract regardless of what the provider claims.
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) throw new AiProviderError('invalid_output', 'The AI response did not match the expected format');
      return {
        data: parsed.data,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Anthropic.RateLimitError) {
        throw new AiProviderError('rate_limited', 'AI provider rate limit reached; try again later');
      }
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new AiProviderError('unavailable', 'AI provider credentials are invalid');
      }
      if (error instanceof Anthropic.BadRequestError) {
        throw new AiProviderError('bad_request', 'AI provider rejected the request');
      }
      if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
        throw new AiProviderError('unavailable', 'AI provider is unavailable');
      }
      throw error;
    }
  }
}
