import { randomUUID } from 'node:crypto';
import { createPool, withTenant, withoutTenant } from '../packages/db/src/index.js';
import { applyProductSeed } from '../packages/db/src/seed/products.js';
import { applyPackageSeed } from '../packages/db/src/seed/packages.js';
import { applyProviderSeed } from '../packages/db/src/seed/providers.js';
import { applyCostSeed } from '../packages/db/src/seed/costs.js';
import { applyDefaultPriceSeed } from '../packages/db/src/seed/default-prices.js';
import { setTenantPackage } from '../packages/core/src/billing/package-admin.js';
import { issueApiKey } from '../packages/core/src/auth/api-keys.js';
import { createUser } from '../packages/core/src/auth/users.js';
import { setPassword } from '../packages/core/src/auth/passwords.js';
import { openPriceVersion } from '../packages/core/src/billing/price-book.js';
import { topUp } from '../packages/core/src/billing/wallet.js';
import { setTenantBinding } from '../packages/core/src/routing/provider-routing.js';
import { setProviderConnection } from '../packages/providers/src/connections.js';
import { setCallback } from '../packages/core/src/webhooks/inbound.js';
import { defineJourney } from '../packages/core/src/onboarding/cases.js';

/**
 * Provisioning, from a terminal.
 *
 * Everything here was possible before this file existed only by writing SQL by hand
 * against a live database, which is how the first workspace of a deployment usually gets
 * created and is a bad way to do it: no audit entry, no password policy, no scopes, and
 * one typo away from a row nobody can explain later.
 *
 * Secrets are printed once and never stored anywhere in readable form: a password is
 * hashed with scrypt and an API key is kept as a SHA-256 hash. Losing what this prints
 * means issuing a new one, which is the correct answer and not a limitation.
 *
 * Usage:
 *   pnpm provision products:seed [--provider stub]
 *   pnpm provision package:assign --tenant <id> --package ENTERPRISE
 *   pnpm provision tenant:create --name "شركة" --slug acme --admin-email a@b.sa
 *   pnpm provision key:issue --tenant <id> --name integration [--scopes a,b]
 *   pnpm provision price:set --tenant <id> --product KYB_COMPLETE --amount 44.00
 *   pnpm provision wallet:topup --tenant <id> --amount 1000 --invoice INV-1
 *   pnpm provision provider:connect --provider wathq --environment live --kind http \
 *     --base-url https://api.wathq.sa --ref kms://providers/wathq/live
 *   pnpm provision provider:callback --provider lean --environment sandbox \
 *     --ref kms://providers/lean/webhook --header lean-signature --algorithm sha512
 *   pnpm provision provider:bind --tenant <id> --provider lean --ref kms://... [--mode BYOC]
 *   pnpm provision sandbox:create --tenant <id>
 *   pnpm provision journey:create --tenant <id> [--code MERCHANT] [--products A,B]
 */

const DEFAULT_SCOPES = [
  'verifications:write',
  'verifications:read',
  'onboarding:write',
  'onboarding:read',
  'products:read',
  'entities:read',
  'wallet:read',
  'portfolios:read',
  'batches:read',
  'reports:read',
  'review:read',
];

interface Args {
  command: string;
  flags: Record<string, string>;
}

function parse(argv: string[]): Args {
  const command = argv[0] ?? '';
  const flags: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith('--') && value !== undefined) {
      flags[key.slice(2)] = value;
    }
  }
  return { command, flags };
}

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function appUrl(): string {
  const url = process.env['NX_APP_DATABASE_URL'];
  if (!url) {
    throw new Error('NX_APP_DATABASE_URL is not set');
  }
  return url;
}

/** Riyals on the command line, halalas in the database. Integers throughout (ADR-021). */
function halalas(riyals: string): number {
  const amount = Number.parseFloat(riyals);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('an amount must be a positive number of riyals');
  }
  return Math.round(amount * 100);
}

function secret(label: string, value: string): void {
  console.log(`${label}: ${value}`);
  console.log('  This is shown once. It is stored only as a hash and cannot be recovered.');
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));
  const pool = createPool(appUrl());

  try {
    switch (command) {
      case 'products:seed': {
        // The catalogue is rows, not code (rule 8), so a deployment has to be given them
        // once before anything can be verified. The plans come with it: since entitlement
        // is checked before every run, a workspace on no plan can run nothing, and a
        // deployment with products and no plans is a deployment that refuses everything.
        const provider = flags['provider'] ?? 'stub';
        await withoutTenant(pool, async (tx) => {
          await applyProductSeed(tx, undefined, { providerName: provider });
          // What each call costs us, so the margin check and the operator screen read a
          // figure rather than assuming one.
          await applyCostSeed(tx);
        });

        // The default list price of each check belongs to no subscriber, so it is written on
        // the owner role, the only one the price book lets write a row without a tenant.
        const adminUrl = process.env['NX_ADMIN_DATABASE_URL'];
        if (adminUrl) {
          const admin = createPool(adminUrl);
          try {
            const client = await admin.connect();
            try {
              await client.query('BEGIN');
              await client.query('SET LOCAL ROLE nx_migrator');
              await applyDefaultPriceSeed({
                query: (text, values) => client.query(text, values as unknown[] | undefined),
              });
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          } finally {
            await admin.end();
          }
        } else {
          console.log('NX_ADMIN_DATABASE_URL is not set: default check prices were not published.');
        }

        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }
        const operator = createPool(operatorUrl);
        try {
          await applyPackageSeed(operator);
          // The panel configures rows. An empty catalogue leaves an operator with no
          // provider to give an address, a credential reference, or an environment to.
          await applyProviderSeed(operator);
        } finally {
          await operator.end();
        }

        console.log(
          `products, packages, providers and costs seeded, steps pointing at provider ${provider}`,
        );
        return;
      }

      case 'package:assign': {
        // The default list price of each check belongs to no subscriber, so it is written on
        // the owner role, the only one the price book lets write a row without a tenant.
        const adminUrl = process.env['NX_ADMIN_DATABASE_URL'];
        if (adminUrl) {
          const admin = createPool(adminUrl);
          try {
            const client = await admin.connect();
            try {
              await client.query('BEGIN');
              await client.query('SET LOCAL ROLE nx_migrator');
              await applyDefaultPriceSeed({
                query: (text, values) => client.query(text, values as unknown[] | undefined),
              });
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          } finally {
            await admin.end();
          }
        } else {
          console.log('NX_ADMIN_DATABASE_URL is not set: default check prices were not published.');
        }

        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }
        const operator = createPool(operatorUrl);
        try {
          await setTenantPackage(
            operator,
            {
              tenantId: required(flags, 'tenant'),
              packageCode: required(flags, 'package'),
            },
            process.env['NX_OPERATOR_ID'] ?? 'nx-staff:provision',
          );
        } finally {
          await operator.end();
        }
        console.log(`package ${flags['package']} assigned`);
        return;
      }

      case 'tenant:create': {
        const legalName = required(flags, 'name');
        const slug = required(flags, 'slug');
        const tenantId = randomUUID();

        // The row is written under its own scope, which is the only way a tenant can be
        // created without a role that crosses subscribers.
        await withTenant(pool, tenantId, (tx) =>
          tx.query('INSERT INTO tenants (id, legal_name, slug) VALUES ($1, $2, $3)', [
            tenantId,
            legalName,
            slug,
          ]),
        );
        console.log(`tenant: ${tenantId}`);
        console.log(`workspace: ${slug}`);

        const email = flags['admin-email'];
        if (email) {
          const password = `nx-${randomUUID()}`;
          await withTenant(pool, tenantId, async (tx) => {
            const userId = await createUser(tx, {
              email,
              displayName: flags['admin-name'] ?? email,
              role: 'ADMIN',
            });
            // Temporary by construction: the person is made to change it on first sign in.
            await setPassword(tx, { userId, password, mustChange: true });
            console.log(`admin: ${userId}`);
          });
          secret('temporary password', password);
        }
        return;
      }

      case 'key:issue': {
        const tenantId = required(flags, 'tenant');
        const name = required(flags, 'name');
        const scopes = (flags['scopes'] ?? DEFAULT_SCOPES.join(','))
          .split(',')
          .map((s) => s.trim());
        const issued = await withTenant(pool, tenantId, (tx) => issueApiKey(tx, { name, scopes }));
        console.log(`key id: ${issued.id}`);
        secret('api key', issued.secret);
        return;
      }

      case 'price:set': {
        const tenantId = required(flags, 'tenant');
        await withTenant(pool, tenantId, (tx) =>
          openPriceVersion(tx, {
            productCode: required(flags, 'product'),
            unitPriceHalalas: halalas(required(flags, 'amount')),
          }),
        );
        console.log(`price set for ${flags['product']}, excluding VAT`);
        return;
      }

      case 'wallet:topup': {
        const tenantId = required(flags, 'tenant');
        const wallet = await withTenant(pool, tenantId, (tx) =>
          topUp(tx, {
            amount: halalas(required(flags, 'amount')),
            vatInvoiceId: required(flags, 'invoice'),
          }),
        );
        console.log(`balance: ${(wallet.balance / 100).toFixed(2)} ${wallet.currency}`);
        return;
      }

      case 'provider:connect': {
        // The same row the operator panel writes. Kept here so a production install can
        // be repeated from a script and reviewed in a change request, rather than
        // depending on somebody remembering which fields they typed.
        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }
        const environment = required(flags, 'environment');
        if (environment !== 'sandbox' && environment !== 'live') {
          throw new Error('an environment is either sandbox or live');
        }
        const kind = flags['kind'] ?? 'http';
        if (kind !== 'stub' && kind !== 'http' && kind !== 'openbanking') {
          throw new Error('a kind is stub, http or openbanking');
        }
        const operator = createPool(operatorUrl);
        try {
          await setProviderConnection(
            operator,
            {
              provider: required(flags, 'provider'),
              environment,
              kind,
              baseUrl: flags['base-url'] ?? null,
              authUrl: flags['auth-url'] ?? null,
              // A pointer, never the material. The column refuses anything else.
              credentialRef: flags['ref'] ?? null,
            },
            process.env['NX_OPERATOR_ID'] ?? 'nx-staff:provision',
          );
        } finally {
          await operator.end();
        }
        console.log(`connection set for ${flags['provider']} in ${environment}`);
        return;
      }

      case 'provider:callback': {
        // Issues the address a provider calls back on. Prints it once, because the next
        // thing that happens to it is being pasted into a supplier's dashboard.
        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }
        const environment = required(flags, 'environment');
        if (environment !== 'sandbox' && environment !== 'live') {
          throw new Error('an environment is either sandbox or live');
        }
        const algorithm = flags['algorithm'] ?? 'sha256';
        if (algorithm !== 'sha256' && algorithm !== 'sha512') {
          throw new Error('an algorithm is sha256 or sha512');
        }
        const operator = createPool(operatorUrl);
        try {
          const { slug } = await setCallback(operator, {
            provider: required(flags, 'provider'),
            environment,
            secretRef: required(flags, 'ref'),
            header: flags['header'] ?? 'x-nx-provider-signature',
            algorithm,
            rotate: flags['rotate'] === 'true',
          });
          const base = process.env['NX_PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
          console.log(`callback url: ${base}/v1/callbacks/${slug}`);
        } finally {
          await operator.end();
        }
        return;
      }

      case 'provider:bind': {
        // A binding names a provider, so it is written on the operator connection: rule 5
        // keeps provider names away from anything a subscriber can reach.
        // The default list price of each check belongs to no subscriber, so it is written on
        // the owner role, the only one the price book lets write a row without a tenant.
        const adminUrl = process.env['NX_ADMIN_DATABASE_URL'];
        if (adminUrl) {
          const admin = createPool(adminUrl);
          try {
            const client = await admin.connect();
            try {
              await client.query('BEGIN');
              await client.query('SET LOCAL ROLE nx_migrator');
              await applyDefaultPriceSeed({
                query: (text, values) => client.query(text, values as unknown[] | undefined),
              });
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          } finally {
            await admin.end();
          }
        } else {
          console.log('NX_ADMIN_DATABASE_URL is not set: default check prices were not published.');
        }

        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }
        const operator = createPool(operatorUrl);
        try {
          await setTenantBinding(
            operator,
            {
              tenantId: required(flags, 'tenant'),
              provider: required(flags, 'provider'),
              // NX calls on its own credential and charges the subscriber here, which is
              // the model the provider agreement allows. BYOC stays available for a
              // subscriber who brings their own account.
              mode: (flags['mode'] ?? 'MANAGED') as 'BYOC' | 'MANAGED',
              credentialRef: required(flags, 'ref'),
              activate: true,
            },
            process.env['NX_OPERATOR_ID'] ?? 'nx-staff:provision',
          );
        } finally {
          await operator.end();
        }
        console.log('binding written');
        return;
      }

      case 'journey:create': {
        // An onboarding journey is rows (rule 8), and a first deployment needs one before
        // a case can be opened. The default is the shape most customers start with.
        const tenantId = required(flags, 'tenant');
        const code = flags['code'] ?? 'MERCHANT';
        const products = (flags['products'] ?? 'KYB_COMPLETE,ADDRESS_ONLY').split(',');

        await withTenant(pool, tenantId, (tx) =>
          defineJourney(tx, {
            code,
            nameAr: flags['name'] ?? 'تأهيل تاجر',
            slaHours: Number.parseInt(flags['sla'] ?? '48', 10),
            steps: products.map((productCode, index) => ({
              stepKey: productCode.trim().toLowerCase(),
              productCode: productCode.trim(),
              seq: index + 1,
              // Each check is handed the part of the applicant record its product asked
              // for, which for these two is the unified number.
              subjectMap: { unn: 'unn' },
            })),
          }),
        );

        console.log(`journey: ${code}`);
        return;
      }

      case 'sandbox:create': {
        // A sandbox is a workspace of its own (ADR-068), so creating one is provisioning
        // a second workspace and linking it, not setting a flag.
        const parent = required(flags, 'tenant');
        const operatorUrl = process.env['NX_OPERATOR_DATABASE_URL'];
        if (!operatorUrl) {
          throw new Error('NX_OPERATOR_DATABASE_URL is not set');
        }

        const sandboxId = randomUUID();
        const operator = createPool(operatorUrl);
        try {
          const { rows } = await operator.query<{ legal_name: string; slug: string }>(
            'SELECT legal_name, slug FROM tenants WHERE id = $1 AND sandbox_of IS NULL',
            [parent],
          );
          const owner = rows[0];
          if (!owner) {
            throw new Error('no such workspace, or it is already a sandbox');
          }

          await withTenant(pool, sandboxId, (tx) =>
            tx.query(`INSERT INTO tenants (id, legal_name, slug) VALUES ($1, $2, $3)`, [
              sandboxId,
              `${owner.legal_name} (Sandbox)`,
              `${owner.slug}-sandbox`,
            ]),
          );
          // The link and the plan are written by the operator: a workspace must not be
          // able to declare itself a sandbox, nor to choose the plan it runs on.
          await operator.query('UPDATE tenants SET sandbox_of = $2 WHERE id = $1', [
            sandboxId,
            parent,
          ]);
          await operator.query(
            `INSERT INTO tenant_commitments (tenant_id, package_code, term_months,
                                             credits_granted_halalas, setup_fee_halalas)
             VALUES ($1, 'SANDBOX', 12, 0, 0)
             ON CONFLICT (tenant_id) DO UPDATE SET package_code = 'SANDBOX'`,
            [sandboxId],
          );
          await setTenantBinding(
            operator,
            {
              tenantId: sandboxId,
              provider: flags['provider'] ?? 'stub',
              mode: 'MANAGED',
              credentialRef: flags['ref'] ?? 'kms://sandbox/stub',
              activate: true,
            },
            process.env['NX_OPERATOR_ID'] ?? 'nx-staff:provision',
          );
        } finally {
          await operator.end();
        }

        // Play money and real prices, so a buyer sees what each call would have cost.
        await withTenant(pool, sandboxId, async (tx) => {
          await topUp(tx, { amount: 1_000_000_00, vatInvoiceId: 'SANDBOX' });
          for (const productCode of (flags['products'] ?? 'ADDRESS_ONLY,KYB_COMPLETE').split(',')) {
            await openPriceVersion(tx, {
              productCode: productCode.trim(),
              unitPriceHalalas: Number.parseInt(flags['price'] ?? '4400', 10),
            });
          }
        });

        console.log(`sandbox: ${sandboxId}`);
        console.log(
          'issue its key with: pnpm provision key:issue --tenant ' + sandboxId + ' --name sandbox',
        );
        return;
      }

      default:
        throw new Error(
          'unknown command. Use products:seed, package:assign, tenant:create, key:issue, price:set, wallet:topup, provider:bind, sandbox:create or journey:create.',
        );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
