/**
 * Our error codes, not a provider's.
 *
 * Every error carries an explicit `retryable` flag and a request id, and never carries a
 * provider name (rule 5) or an identifier value (rule 4). Messages are bilingual because
 * they reach an end user through the console and the API.
 */

export type NxErrorCode =
  | 'NX-4001'
  | 'NX-4002'
  | 'NX-4003'
  | 'NX-4011'
  | 'NX-4029'
  | 'NX-4031'
  | 'NX-4041'
  | 'NX-4091'
  | 'NX-5001'
  | 'NX-5002';

interface NxErrorShape {
  status: number;
  retryable: boolean;
  messageAr: string;
  messageEn: string;
}

/**
 * Every error the API can return, for the reference screen (ADR-169).
 *
 * The screen cited NX-4031 as an example and had no table, and the call log printed codes raw
 * with nothing to look them up in. A developer integrating against this platform met a code
 * and had to ask us what it meant, which is the one thing an error code exists to avoid.
 */
export function errorCatalogue(): {
  code: NxErrorCode;
  status: number;
  retryable: boolean;
  messageAr: string;
  messageEn: string;
}[] {
  return (Object.keys(CATALOG) as NxErrorCode[])
    .sort()
    .map((code) => ({ code, ...CATALOG[code] }));
}

const CATALOG: Record<NxErrorCode, NxErrorShape> = {
  'NX-4001': {
    status: 400,
    retryable: false,
    messageAr: 'المدخلات غير صالحة',
    messageEn: 'Invalid input',
  },
  'NX-4002': {
    status: 422,
    retryable: false,
    messageAr: 'المدخلات لا تطابق مخطط المنتج',
    messageEn: 'Input does not match the product schema',
  },
  // A change that is well formed and still refused, because the thing being changed is not a
  // choice: switching off a module every customer file is drawn from, for one.
  'NX-4003': {
    status: 422,
    retryable: false,
    messageAr: 'تغيير غير مسموح',
    messageEn: 'The change is not allowed',
  },
  'NX-4011': {
    status: 401,
    retryable: false,
    messageAr: 'مفتاح غير صالح',
    messageEn: 'Invalid credentials',
  },
  'NX-4029': {
    status: 429,
    retryable: true,
    messageAr: 'تجاوزت الحد المسموح، أعد المحاولة لاحقاً',
    messageEn: 'Rate limit exceeded, retry later',
  },
  'NX-4031': {
    status: 403,
    retryable: false,
    messageAr: 'الصلاحية غير كافية',
    messageEn: 'Insufficient scope',
  },
  'NX-4041': {
    status: 404,
    retryable: false,
    messageAr: 'غير موجود',
    messageEn: 'Not found',
  },
  'NX-4091': {
    status: 409,
    retryable: false,
    messageAr: 'المعرّف مرتبط بكيان آخر',
    messageEn: 'The identifier already belongs to another entity',
  },
  'NX-5001': {
    status: 500,
    retryable: false,
    messageAr: 'خطأ داخلي',
    messageEn: 'Internal error',
  },
  'NX-5002': {
    status: 503,
    retryable: true,
    messageAr: 'الخدمة غير متاحة مؤقتاً',
    messageEn: 'Temporarily unavailable',
  },
};

export interface NxErrorOptions {
  detail?: string;
  requestId?: string;
  cause?: unknown;
}

export class NxError extends Error {
  readonly code: NxErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly requestId: string | undefined;

  constructor(code: NxErrorCode, options: NxErrorOptions = {}) {
    const shape = CATALOG[code];
    super(
      options.detail
        ? `${code}: ${shape.messageEn}. ${options.detail}`
        : `${code}: ${shape.messageEn}`,
    );
    this.name = 'NxError';
    this.code = code;
    this.status = shape.status;
    this.retryable = shape.retryable;
    this.messageAr = shape.messageAr;
    this.messageEn = shape.messageEn;
    this.requestId = options.requestId;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** The public shape. Never includes a provider name, an identifier, or a stack. */
  toPublicJson(): {
    code: NxErrorCode;
    message_ar: string;
    message_en: string;
    retryable: boolean;
    request_id: string | undefined;
  } {
    return {
      code: this.code,
      message_ar: this.messageAr,
      message_en: this.messageEn,
      retryable: this.retryable,
      request_id: this.requestId,
    };
  }
}
