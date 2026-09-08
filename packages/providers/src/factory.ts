import { ProviderRegistry } from './registry.js';
import { StubProvider } from './stub/stub-provider.js';
import { HttpVerificationProvider } from './http/http-provider.js';

/**
 * Choosing which provider is running.
 *
 * This exists so that no application ever names an implementation. An application asks
 * for a registry and gets one; which provider is behind it is a deployment decision
 * expressed as environment, exactly as the architecture rules require: one product, one
 * codebase, and deployments that differ by configuration rather than by a second branch.
 *
 * It is also what keeps the unit 9 boundary honest. Wiring a real provider from an app
 * would put its name outside this package, and the boundary test would fail.
 */

export interface ProviderConfig {
  name: string;
  kind: 'stub' | 'http';
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  maxAttempts?: number | undefined;
}

export function createProviderRegistry(configs: readonly ProviderConfig[]): ProviderRegistry {
  const registry = new ProviderRegistry();

  for (const config of configs) {
    if (config.kind === 'stub') {
      registry.register(new StubProvider({ name: config.name }));
      continue;
    }
    if (!config.baseUrl) {
      throw new Error(`provider ${config.name} is configured as http without a base url`);
    }
    registry.register(
      new HttpVerificationProvider({
        name: config.name,
        baseUrl: config.baseUrl,
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
      }),
    );
  }

  return registry;
}

/**
 * Reads the configuration from the environment.
 *
 *   NX_PROVIDERS=stub                       the built in stub, for sandbox and tests
 *   NX_PROVIDERS=wathq:https://api.example  a real provider at a base url
 *
 * Several may be listed, separated by commas, which is how a second provider is carried
 * ready but inactive: registered, healthy, and named as a fallback on the steps that want
 * one, without any code changing on the day it is needed.
 */
export function providerConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderConfig[] {
  const raw = env['NX_PROVIDERS'] ?? 'stub';

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): ProviderConfig => {
      const separator = entry.indexOf(':');
      if (separator === -1) {
        return { name: entry, kind: 'stub' };
      }
      return {
        name: entry.slice(0, separator),
        kind: 'http',
        baseUrl: entry.slice(separator + 1),
      };
    });
}
