/**
 * Our error codes, not a provider's.
 *
 * Every error carries an explicit `retryable` flag and a request id, and never carries a
 * provider name (rule 5) or an identifier value (rule 4). Messages are bilingual because
 * they reach an end user through the console and the API.
 */

export type NxErrorCode = 'NX-4001' | 'NX-4002' | 'NX-4041' | 'NX-4091' | 'NX-5001' | 'NX-5002';

interface NxErrorShape {
  status: number;
  retryable: boolean;
  messageAr: string;
  messageEn: string;
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
