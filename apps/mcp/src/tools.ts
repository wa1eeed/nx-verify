import { z } from 'zod';
import { idempotencyKeyFor, type NxApiClient } from './client.js';

/**
 * The tools an agent is given, and the ones it is deliberately not given.
 *
 * What an agent can do here: read the catalogue, ask what something costs, run a
 * verification it has been told the price of, read a run, read an entity profile, read
 * the balance, and confirm a seal. That is the whole surface.
 *
 * What it cannot do, and why:
 *
 * - Decide a review case. The four eyes rule in the schema wants two identified people,
 *   and a model is not one. A model that could approve a case would make the maker and
 *   checker columns decorative.
 * - Change a provider binding, a price, a decision rule or a retention policy. Those are
 *   configuration, they change what every later run costs and concludes, and they belong
 *   to a person who signed something.
 * - Name a tenant. There is no tenant argument on any tool. The API key fixes the
 *   subscriber, so no prompt can move an agent sideways into another one (rule 2).
 * - Read another subscriber's document, or any provider name. The server cannot leak a
 *   provider because it has never been told one: it is an API client, and the API does
 *   not say (rule 5).
 */

export class ToolRefusal extends Error {
  readonly messageAr: string;

  constructor(messageAr: string, messageEn: string) {
    super(messageEn);
    this.name = 'ToolRefusal';
    this.messageAr = messageAr;
  }
}

/**
 * A ceiling on what one session may spend.
 *
 * An agent in a loop with a mistaken plan will call a paid tool as many times as the loop
 * runs, and the subscriber discovers it on the invoice. The ceiling is set by the person
 * who starts the server, not by anything the model can reach.
 */
export class SpendLimit {
  #spent = 0;

  constructor(private readonly ceiling: number) {}

  get spent(): number {
    return this.#spent;
  }

  get remaining(): number {
    return Math.max(0, this.ceiling - this.#spent);
  }

  assertRoom(amount: number): void {
    if (this.#spent + amount > this.ceiling) {
      throw new ToolRefusal(
        `تجاوز سقف الإنفاق لهذه الجلسة. المتبقي ${riyals(this.remaining)} ريال والمطلوب ${riyals(amount)} ريال. يرفع السقف من يشغّل الخادم لا النموذج.`,
        `Session spend ceiling reached. ${riyals(this.remaining)} SAR left, ${riyals(amount)} SAR requested. The ceiling is raised by whoever starts the server, not by the model.`,
      );
    }
  }

  commit(amount: number): void {
    this.#spent += amount;
  }
}

function riyals(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

function toHalalas(riyalAmount: number): number {
  return Math.round(riyalAmount * 100);
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** True for the tools that spend money or write. Shown to the host as a hint. */
  writes: boolean;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolOptions {
  /** Halalas. Integers throughout, per ADR-021. */
  spendCeiling?: number;
}

interface ProductRow {
  code: string;
  name_ar: string;
  name_en: string;
  subject_type: string;
  input_schema: unknown;
  price: { amount: number; currency: string } | null;
}

export function createTools(
  client: NxApiClient,
  options: ToolOptions = {},
): { tools: ToolDefinition[]; limit: SpendLimit } {
  const limit = new SpendLimit(options.spendCeiling ?? 50_000);

  const expect = async (
    method: 'GET' | 'POST',
    path: string,
    init?: { body?: unknown; idempotencyKey?: string },
  ): Promise<unknown> => {
    const response = await client.request(method, path, init ?? {});
    if (response.status >= 400) {
      throw refusalFromError(response.body);
    }
    return response.body;
  };

  const priceOf = async (product: string): Promise<{ halalas: number; row: ProductRow }> => {
    const body = (await expect('GET', '/v1/products')) as { products?: ProductRow[] };
    const row = (body.products ?? []).find((entry) => entry.code === product);
    if (!row) {
      throw new ToolRefusal(
        `لا يوجد منتج بالرمز ${product}. استخدم list_products لمعرفة المتاح.`,
        `No product with code ${product}. Use list_products to see what is available.`,
      );
    }
    if (row.price === null) {
      throw new ToolRefusal(
        `المنتج ${product} بلا سعر لهذا المشترك، فلا يمكن تشغيله من هنا.`,
        `Product ${product} has no price for this subscriber, so it cannot be run from here.`,
      );
    }
    return { halalas: toHalalas(row.price.amount), row };
  };

  const tools: ToolDefinition[] = [
    {
      name: 'list_products',
      title: 'قائمة منتجات التحقق',
      description:
        'Lists the verification products available to this subscriber, with the input each one expects and its price without VAT.',
      inputSchema: {},
      writes: false,
      handler: async () => expect('GET', '/v1/products'),
    },
    {
      name: 'quote_verification',
      title: 'تسعير تحقق',
      description:
        'Returns what one run of a product costs, in SAR without VAT, plus the spend left in this session. Call this before run_verification: its confirm_cost argument must equal the amount returned here.',
      inputSchema: { product: z.string().min(1) },
      writes: false,
      handler: async (input) => {
        const product = String(input['product']);
        const { halalas, row } = await priceOf(product);
        return {
          product,
          name_ar: row.name_ar,
          subject_type: row.subject_type,
          input_schema: row.input_schema,
          cost: Number(riyals(halalas)),
          currency: 'SAR',
          note_en: 'Price excludes VAT. Pass this figure as confirm_cost.',
          session_remaining: Number(riyals(limit.remaining)),
        };
      },
    },
    {
      name: 'run_verification',
      title: 'تشغيل تحقق',
      description:
        'Runs one verification and charges for it. Requires confirm_cost equal to the figure quote_verification returned, and a reference that identifies this request on the caller side. Re-running with the same product, subject and reference returns the first result and is not charged again.',
      inputSchema: {
        product: z.string().min(1),
        subject: z.record(z.unknown()),
        reference: z.string().min(1).max(64),
        confirm_cost: z.number().nonnegative(),
      },
      writes: true,
      handler: async (input) => {
        const product = String(input['product']);
        const reference = String(input['reference']);
        const subject = input['subject'] as Record<string, unknown>;
        const { halalas } = await priceOf(product);

        // The number the caller sends back has to be the number it was shown. A model
        // that never read the price has not been told what this costs, and the person who
        // reads the transcript later should be able to see that it was told.
        if (toHalalas(Number(input['confirm_cost'])) !== halalas) {
          throw new ToolRefusal(
            `التكلفة المؤكَّدة لا تطابق السعر. السعر ${riyals(halalas)} ريال بلا ضريبة. استدعِ quote_verification أولاً وأعد الرقم كما هو.`,
            `The confirmed cost does not match the price, which is ${riyals(halalas)} SAR excluding VAT. Call quote_verification first and send that figure back.`,
          );
        }

        limit.assertRoom(halalas);

        const result = (await expect('POST', '/v1/verifications', {
          body: { product, subject, reference },
          idempotencyKey: idempotencyKeyFor(product, reference, subject),
        })) as { replayed?: boolean };

        // A replay is the same result at no further charge, so it does not touch the
        // ceiling either.
        if (result.replayed !== true) {
          limit.commit(halalas);
        }
        return { ...result, session_remaining: Number(riyals(limit.remaining)) };
      },
    },
    {
      name: 'get_verification',
      title: 'قراءة تحقق',
      description:
        'Reads a verification by id: its status, decision, the per step outcome and the link to its sealed evidence.',
      inputSchema: { verification_id: z.string().uuid() },
      writes: false,
      handler: async (input) => expect('GET', `/v1/verifications/${String(input['verification_id'])}`),
    },
    {
      name: 'get_entity_profile',
      title: 'ملف الكيان',
      description:
        'Reads the live profile of an entity. Every field carries the authority that issued it, when it was observed, and whether it is still fresh under the policy in force now.',
      inputSchema: { entity_id: z.string().uuid() },
      writes: false,
      handler: async (input) => expect('GET', `/v1/entities/${String(input['entity_id'])}`),
    },
    {
      name: 'get_wallet_balance',
      title: 'رصيد الخدمات',
      description: 'Reads the service balance: total, held against running work, and available.',
      inputSchema: {},
      writes: false,
      handler: async () => {
        const wallet = await expect('GET', '/v1/wallet');
        return { ...(wallet as object), session_remaining: Number(riyals(limit.remaining)) };
      },
    },
    {
      name: 'check_evidence',
      title: 'فحص ختم مستند',
      description:
        'Confirms that a sealed document is ours and when it was sealed, from the token printed on it. Returns the seal and its time only, and nothing about the subject.',
      inputSchema: { token: z.string().min(1) },
      writes: false,
      handler: async (input) => expect('GET', `/v1/evidence/${String(input['token'])}`),
    },
  ];

  return { tools, limit };
}

/**
 * Our error, turned into something a model can act on.
 *
 * The subject is never echoed back. An error message that repeats the identifier it
 * failed on puts that identifier into a transcript, a log and a context window, which is
 * three of the places rule 4 says it must never be.
 */
function refusalFromError(body: unknown): ToolRefusal {
  const error = (body as { error?: { code?: string; message_ar?: string; message_en?: string } })
    ?.error;
  if (!error) {
    return new ToolRefusal('تعذّر تنفيذ الطلب.', 'The request could not be completed.');
  }
  const code = error.code ?? 'NX-5000';
  return new ToolRefusal(
    `${code}: ${error.message_ar ?? 'تعذّر تنفيذ الطلب.'}`,
    `${code}: ${error.message_en ?? 'The request could not be completed.'}`,
  );
}
