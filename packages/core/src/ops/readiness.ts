import type { Queryable } from '@nx-verify/db';

/**
 * Whether this deployment is actually installed.
 *
 * docs/04-install.md is a list of things somebody has to remember. This is the same list,
 * asked of the running system, because an install guide checks nothing and the failures
 * it is meant to prevent all look alike from outside: a call that works in one
 * environment and not the other, a notification nobody receives, a transfer nobody can
 * send.
 *
 * Three rules shape what a check may say.
 *
 * It reports what it found and never guesses why. A check that says "probably a firewall"
 * sends an operator to look at the wrong thing.
 *
 * It names the exact thing to change. A red row that does not say what to set is a red
 * row somebody learns to ignore.
 *
 * And it reads configuration only. No tenant, no entity, no attestation, no usage count:
 * readiness is a property of the deployment, and a screen about the deployment that can
 * read a subscriber's data is a screen that will eventually show it.
 */

export type ReadinessState = 'ok' | 'warn' | 'blocked';

export interface ReadinessCheck {
  id: string;
  titleAr: string;
  state: ReadinessState;
  /** What was found. Present tense, no speculation. */
  detailAr: string;
  /** The exact variable, command or screen that changes it. */
  fixAr: string | null;
}

export interface ReadinessInput {
  env: Readonly<Record<string, string | undefined>>;
  /** Whether the deployment's secret store accepts writes from the panel. */
  secretsWritable: boolean;
  /** What the files define, and what the ledger says is applied. */
  migrations: { defined: number; applied: number };
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  /** Nothing blocked. A deployment can still be short of ready with warnings. */
  canServeLive: boolean;
}

export async function checkReadiness(
  db: Queryable,
  input: ReadinessInput,
): Promise<ReadinessReport> {
  const { env } = input;
  const checks: ReadinessCheck[] = [];

  checks.push(migrationsCheck(input.migrations));
  checks.push(await catalogueCheck(db));
  checks.push(...(await connectionChecks(db)));
  checks.push(secretsCheck(env, input.secretsWritable));
  checks.push(keysCheck(env));
  checks.push(mailCheck(env));
  checks.push(addressCheck(env));
  checks.push(bankCheck(env));
  checks.push(operatorTokenCheck(env));

  return {
    checks,
    canServeLive: checks.every((check) => check.state !== 'blocked'),
  };
}

function migrationsCheck(migrations: { defined: number; applied: number }): ReadinessCheck {
  if (migrations.applied === migrations.defined) {
    return {
      id: 'migrations',
      titleAr: 'الترحيلات',
      state: 'ok',
      detailAr: `${migrations.applied} ترحيلاً مطبّقاً، وهو ما تعرّفه الملفات.`,
      fixAr: null,
    };
  }
  return {
    id: 'migrations',
    titleAr: 'الترحيلات',
    state: 'blocked',
    detailAr: `${migrations.applied} مطبّق من ${migrations.defined} تعرّفه الملفات.`,
    fixAr: 'pnpm migrate',
  };
}

async function catalogueCheck(db: Queryable): Promise<ReadinessCheck> {
  const { rows } = await db.query<{ products: string; packages: string; providers: string }>(
    `SELECT (SELECT count(*) FROM products)::text AS products,
            (SELECT count(*) FROM packages)::text AS packages,
            (SELECT count(*) FROM provider_catalog)::text AS providers`,
  );
  const counts = rows[0];
  const products = Number(counts?.products ?? 0);
  const packages = Number(counts?.packages ?? 0);
  const providers = Number(counts?.providers ?? 0);
  const seeded = products > 0 && packages > 0 && providers > 0;

  return {
    id: 'catalogue',
    titleAr: 'الكتالوج',
    state: seeded ? 'ok' : 'blocked',
    detailAr: `${products} وحدة تحقق، ${packages} باقة، ${providers} مزوّد.`,
    fixAr: seeded ? null : 'pnpm provision products:seed',
  };
}

async function connectionChecks(db: Queryable): Promise<ReadinessCheck[]> {
  const { rows } = await db.query<{
    environment: string;
    configured: string;
    without_credential: string;
  }>(
    `SELECT environment,
            count(*)::text AS configured,
            count(*) FILTER (WHERE kind <> 'stub' AND credential_ref IS NULL)::text
              AS without_credential
     FROM provider_connections
     WHERE status = 'active'
     GROUP BY environment`,
  );

  const byEnvironment = new Map(rows.map((row) => [row.environment, row]));

  return (['sandbox', 'live'] as const).map((environment): ReadinessCheck => {
    const row = byEnvironment.get(environment);
    const configured = Number(row?.configured ?? 0);
    const missing = Number(row?.without_credential ?? 0);
    const label = environment === 'sandbox' ? 'بيئة الاختبار' : 'بيئة الإنتاج';
    const id = `connections.${environment}`;
    const titleAr = `اتصال المزودين · ${label}`;

    if (configured === 0) {
      return {
        id,
        titleAr,
        // A sandbox with nothing connected is a deployment nobody can try. A production
        // one is a deployment that cannot serve, which is the harder stop.
        state: environment === 'live' ? 'blocked' : 'warn',
        detailAr: 'لا مزوّد مضبوط في هذه البيئة.',
        fixAr: 'شاشة ربط المزودين، أو pnpm provision provider:connect',
      };
    }

    if (missing > 0) {
      return {
        id,
        titleAr,
        state: 'blocked',
        detailAr: `${configured} مضبوط، منها ${missing} بلا مرجع اعتماد.`,
        fixAr: 'اكتب مرجع الاعتماد بالشكل kms://providers/<provider>/<env>',
      };
    }

    return {
      id,
      titleAr,
      state: 'ok',
      detailAr: `${configured} مزوّداً مضبوطاً، ولكلٍّ مرجع اعتماد.`,
      fixAr: null,
    };
  });
}

function secretsCheck(
  env: Readonly<Record<string, string | undefined>>,
  writable: boolean,
): ReadinessCheck {
  if (env['NX_SECRETS_ENDPOINT']) {
    return {
      id: 'secrets',
      titleAr: 'مخزن الأسرار',
      state: writable ? 'ok' : 'warn',
      detailAr: writable
        ? 'مدير أسرار موصول، واللوحة تستطيع الكتابة فيه.'
        : 'مدير أسرار موصول ولا يقبل الكتابة من اللوحة.',
      fixAr: writable ? null : 'تحقّق من NX_SECRETS_TOKEN وصلاحياته',
    };
  }

  return {
    id: 'secrets',
    titleAr: 'مخزن الأسرار',
    // Refused outright in production by secretStoreFromEnv, so this is the warning a
    // development deployment gets before it discovers that at the worst moment.
    state: env['NODE_ENV'] === 'production' ? 'blocked' : 'warn',
    detailAr: 'الأسرار تُقرأ من متغيّر البيئة NX_SECRETS، ولا تستطيع لوحة أن تكتب فيه.',
    fixAr: 'NX_SECRETS_ENDPOINT و NX_SECRETS_TOKEN',
  };
}

function keysCheck(env: Readonly<Record<string, string | undefined>>): ReadinessCheck {
  if (env['NX_KMS_ENDPOINT']) {
    return {
      id: 'keys',
      titleAr: 'خدمة المفاتيح',
      state: 'ok',
      detailAr: 'المفتاح الجذر من خدمة مفاتيح خارجية.',
      fixAr: null,
    };
  }
  return {
    id: 'keys',
    titleAr: 'خدمة المفاتيح',
    state: env['NODE_ENV'] === 'production' ? 'blocked' : 'warn',
    detailAr: 'المفتاح الجذر من متغيّر بيئة. يصلح للتطوير ولا يصلح لبيانات حقيقية.',
    fixAr: 'NX_KMS_ENDPOINT و NX_KMS_TOKEN',
  };
}

function mailCheck(env: Readonly<Record<string, string | undefined>>): ReadinessCheck {
  const configured = Boolean(
    env['NX_MAIL_ENDPOINT'] && env['NX_MAIL_TOKEN'] && env['NX_MAIL_FROM'],
  );
  return {
    id: 'mail',
    titleAr: 'تسليم البريد',
    // A warning and not a block: nothing is lost, the queue holds. But a customer who was
    // told they would be notified is not being notified.
    state: configured ? 'ok' : 'warn',
    detailAr: configured
      ? 'نقطة تسليم مضبوطة.'
      : 'لا نقطة تسليم. التنبيهات تبقى في الطابور ولا تضيع، ولا تصل أحداً.',
    fixAr: configured ? null : 'NX_MAIL_ENDPOINT و NX_MAIL_TOKEN و NX_MAIL_FROM',
  };
}

function addressCheck(env: Readonly<Record<string, string | undefined>>): ReadinessCheck {
  const missing = [
    env['NX_PUBLIC_BASE_URL'] ? null : 'NX_PUBLIC_BASE_URL',
    env['NX_CONSOLE_BASE_URL'] ? null : 'NX_CONSOLE_BASE_URL',
  ].filter((name): name is string => name !== null);

  if (missing.length === 0) {
    return {
      id: 'addresses',
      titleAr: 'العناوين العامة',
      state: 'ok',
      detailAr: 'عنوان الـAPI وعنوان الكونسول مضبوطان.',
      fixAr: null,
    };
  }

  return {
    id: 'addresses',
    titleAr: 'العناوين العامة',
    // Evidence links and shared profile links are built from these. A wrong one produces
    // links that look right and open nothing, which is worse than none at all.
    state: 'blocked',
    detailAr: 'روابط الأدلة وملفات المشاركة تُبنى منها.',
    fixAr: missing.join(' و '),
  };
}

function bankCheck(env: Readonly<Record<string, string | undefined>>): ReadinessCheck {
  const set = Boolean(env['NX_BANK_IBAN'] && env['NX_BANK_ACCOUNT_NAME']);
  return {
    id: 'bank',
    titleAr: 'حساب التحويل',
    state: set ? 'ok' : 'warn',
    detailAr: set
      ? 'بيانات الحساب تظهر للمشترك عند طلب الشحن.'
      : 'المشترك يطلب الشحن ولا يرى إلى أين يحوّل.',
    fixAr: set ? null : 'NX_BANK_ACCOUNT_NAME و NX_BANK_NAME و NX_BANK_IBAN',
  };
}

function operatorTokenCheck(env: Readonly<Record<string, string | undefined>>): ReadinessCheck {
  const token = env['NX_OPERATOR_TOKEN'] ?? '';
  if (token.length >= 32) {
    return {
      id: 'operator_token',
      titleAr: 'رمز المشغّل',
      state: 'ok',
      detailAr: 'طوله كافٍ.',
      fixAr: null,
    };
  }
  return {
    id: 'operator_token',
    titleAr: 'رمز المشغّل',
    // It opens every screen that names a provider and every screen that moves money.
    state: token.length >= 24 ? 'warn' : 'blocked',
    detailAr:
      token.length === 0
        ? 'غير مضبوط.'
        : `طوله ${token.length} محرفاً، وهو يفتح كل شاشة تسمّي مزوّداً وكل شاشة تحرّك مالاً.`,
    fixAr: 'NX_OPERATOR_TOKEN بقيمة عشوائية لا تقل عن 32 محرفاً',
  };
}
