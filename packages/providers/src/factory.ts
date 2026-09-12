import { ProviderRegistry } from './registry.js';
import { StubProvider } from './stub/stub-provider.js';
import { HttpVerificationProvider } from './http/http-provider.js';
import { LeanProvider } from './lean/lean-provider.js';

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
  kind: 'stub' | 'http' | 'openbanking';
  baseUrl?: string | undefined;
  /** Open banking only: the identity service that issues the access token. */
  authUrl?: string | undefined;
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
    if (config.kind === 'openbanking') {
      if (!config.baseUrl || !config.authUrl) {
        throw new Error(
          `provider ${config.name} is configured as openbanking without both an api url and an auth url`,
        );
      }
      registry.register(
        new LeanProvider({
          name: config.name,
          baseUrl: config.baseUrl,
          authUrl: config.authUrl,
          ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        }),
      );
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
 * An open banking provider needs two hosts, because it mints a token at one and asks
 * questions at the other, so it is listed separately rather than by overloading the
 * format above:
 *
 *   NX_OPENBANKING_PROVIDERS=bankdata:https://api.example;https://auth.example/oauth2/token
 *
 * Several may be listed, separated by commas, which is how a second provider is carried
 * ready but inactive: registered, healthy, and named as a fallback on the steps that want
 * one, without any code changing on the day it is needed.
 */
export function providerConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderConfig[] {
  const raw = env['NX_PROVIDERS'] ?? 'stub';
  const openBanking = env['NX_OPENBANKING_PROVIDERS'] ?? '';

  const openBankingConfigs = openBanking
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): ProviderConfig => {
      const separator = entry.indexOf(':');
      const name = entry.slice(0, separator);
      const [baseUrl, authUrl] = entry.slice(separator + 1).split(';');
      if (!name || !baseUrl || !authUrl) {
        throw new Error('NX_OPENBANKING_PROVIDERS entries must be <name>:<api url>;<auth url>');
      }
      return { name, kind: 'openbanking', baseUrl, authUrl };
    });

  return openBankingConfigs.concat(raw
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
    }));
}
