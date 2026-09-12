import { randomUUID } from 'node:crypto';
import { createPool, withTenant, withoutTenant } from '../packages/db/src/index.js';
import { applyProductSeed } from '../packages/db/src/seed/products.js';
import { issueApiKey } from '../packages/core/src/auth/api-keys.js';
import { createUser } from '../packages/core/src/auth/users.js';
import { setPassword } from '../packages/core/src/auth/passwords.js';
import { openPriceVersion } from '../packages/core/src/billing/price-book.js';
import { topUp } from '../packages/core/src/billing/wallet.js';
import { setTenantBinding } from '../packages/core/src/routing/provider-routing.js';

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
 *   pnpm provision tenant:create --name "شركة" --slug acme --admin-email a@b.sa
 *   pnpm provision key:issue --tenant <id> --name integration [--scopes a,b]
 *   pnpm provision price:set --tenant <id> --product KYB_COMPLETE --amount 44.00
 *   pnpm provision wallet:topup --tenant <id> --amount 1000 --invoice INV-1
 *   pnpm provision provider:bind --tenant <id> --provider stub --ref kms://... [--mode BYOC]
 *   pnpm provision sandbox:create --tenant <id>
 */

const DEFAULT_SCOPES = [
  'verifications:write',
  'verifications:read',
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
        // once before anything can be verified.
        const provider = flags['provider'] ?? 'stub';
        await withoutTenant(pool, (tx) => applyProductSeed(tx, undefined, { providerName: provider }));
        console.log(`products seeded, steps pointing at provider ${provider}`);
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
        const scopes = (flags['scopes'] ?? DEFAULT_SCOPES.join(',')).split(',').map((s) => s.trim());
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

      case 'provider:bind': {
        // A binding names a provider, so it is written on the operator connection: rule 5
        // keeps provider names away from anything a subscriber can reach.
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
              mode: (flags['mode'] ?? 'BYOC') as 'BYOC' | 'MANAGED',
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
            tx.query(
              `INSERT INTO tenants (id, legal_name, slug) VALUES ($1, $2, $3)`,
              [sandboxId, `${owner.legal_name} (Sandbox)`, `${owner.slug}-sandbox`],
            ),
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
              mode: 'BYOC',
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
        console.log('issue its key with: pnpm provision key:issue --tenant ' + sandboxId + ' --name sandbox');
        return;
      }

      default:
        throw new Error(
          'unknown command. Use products:seed, tenant:create, key:issue, price:set, wallet:topup, provider:bind or sandbox:create.',
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
