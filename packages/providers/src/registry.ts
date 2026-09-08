import { NxError } from '@nx-verify/core';
import type { VerificationProvider } from './types.js';

/**
 * The provider registry.
 *
 * Two jobs. It resolves a provider by name for the step executor, and it is the single
 * place that knows every provider name, which is what lets the redaction layer strip
 * them from anything leaving the system without a hardcoded list (rule 5).
 */
export class ProviderRegistry {
  readonly #providers = new Map<string, VerificationProvider>();

  register(provider: VerificationProvider): this {
    this.#providers.set(provider.name, provider);
    return this;
  }

  get(name: string): VerificationProvider {
    const provider = this.#providers.get(name);
    if (!provider) {
      // The requested name is internal and does not go into the message.
      throw new NxError('NX-5001', { detail: 'no provider is registered under that name' });
    }
    return provider;
  }

  has(name: string): boolean {
    return this.#providers.has(name);
  }

  /** Every registered name. The redaction layer takes this list. */
  names(): string[] {
    return [...this.#providers.keys()];
  }

  /** Providers able to serve an endpoint, in registration order. */
  forEndpoint(endpoint: string): VerificationProvider[] {
    return [...this.#providers.values()].filter((provider) =>
      provider.endpoints.includes(endpoint),
    );
  }
}
