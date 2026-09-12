import QRCode from 'qrcode';
import type { TenantTransaction } from '@nx-verify/db';
import { NxError } from '../errors.js';
import { fieldLabelAr } from '../profile/field-catalogue.js';
import type { EvidenceContent } from './evidence.js';

/**
 * The evidence document.
 *
 * docs/01-blueprint.md calls this the strongest commercial output, and what makes it
 * worth anything is not that it exists but that someone can check it later. So the page
 * carries the seal and a code that opens the public verification page, and that page
 * shows the hash and the sealing time and nothing else.
 *
 * Two rules shape what goes on it. Rule 6: every fact carries the authority that issued
 * it and the moment it was observed, or it does not appear. Rule 5: the provider is not
 * among them, and the authority is.
 *
 * The document is rendered as HTML rather than PDF, and that is a deliberate limit rather
 * than an oversight. Correct Arabic in a PDF needs a shaping engine and an embedded font,
 * and a font cannot be bundled here nor assumed present on a deployment target. HTML is
 * shaped correctly by every viewer, prints to PDF from any browser, and leaves the choice
 * of renderer to the deployment. See ADR-047.
 */

export interface DocumentHeader {
  /** The subscriber this document belongs to, printed on it. */
  tenantName: string;
  verificationId: string;
  productNameAr: string;
  entityName: string | null;
  status: string;
  decision: string | null;
  decisionReasons: { code: string; messageAr: string }[];
  /** A document sealed in a sandbox says so on its face. */
  sandbox: boolean;
}

export interface DocumentField {
  labelAr: string;
  authority: string;
  observedAt: string;
}

export interface EvidenceDocument {
  header: DocumentHeader;
  fields: DocumentField[];
  contentHash: string;
  sealedAt: string;
  /** Where the public check lives. Encoded into the code on the page. */
  verifyUrl: string;
}


const STATUS_LABELS: Record<string, string> = {
  OK: 'مكتمل',
  PARTIAL: 'مكتمل جزئياً',
  NOT_FOUND: 'غير موجود',
  ERROR: 'تعذّر',
};

const DECISION_LABELS: Record<string, string> = {
  PASS: 'مقبول',
  FAIL: 'مرفوض',
  REVIEW: 'يحتاج مراجعة',
};

export interface BuildDocumentInput {
  content: EvidenceContent;
  contentHash: string;
  publicToken: string;
  /** Base address of the public verification page. */
  verifyBaseUrl: string;
}

export async function buildEvidenceDocument(
  tx: TenantTransaction,
  input: BuildDocumentInput,
): Promise<EvidenceDocument> {
  const { rows } = await tx.query<{
    legal_name: string;
    name_ar: string;
    display_name: string | null;
    decision_reasons: { code: string; message_ar: string }[] | null;
    sandbox: boolean;
  }>(
    `SELECT t.legal_name, p.name_ar, e.display_name, r.decision_reasons,
            (t.sandbox_of IS NOT NULL) AS sandbox
     FROM verification_runs r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN products p ON p.code = r.product_code
     LEFT JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.entity_id
     WHERE r.tenant_id = $1 AND r.id = $2`,
    [tx.tenantId, input.content.runId],
  );

  const row = rows[0];
  if (!row) {
    throw new NxError('NX-4041', { detail: 'no such run' });
  }

  return {
    header: {
      tenantName: row.legal_name,
      verificationId: input.content.runId,
      productNameAr: row.name_ar,
      entityName: row.display_name,
      status: input.content.status,
      decision: input.content.decision,
      decisionReasons: (row.decision_reasons ?? []).map((reason) => ({
        code: reason.code,
        messageAr: reason.message_ar,
      })),
      sandbox: row.sandbox,
    },
    // Rule 6 in the shape of a document: a line exists only if it has an authority and a
    // time. There is no branch here that prints a value without them.
    fields: input.content.fields
      .filter((field) => field.authority !== null)
      .map((field) => ({
        labelAr: fieldLabelAr(field.fieldPath),
        authority: field.authority ?? '',
        observedAt: field.observedAt.slice(0, 10),
      })),
    contentHash: input.contentHash,
    sealedAt: input.content.sealedAt,
    verifyUrl: `${input.verifyBaseUrl.replace(/\/$/, '')}/v1/evidence/${input.publicToken}`,
  };
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function decisionLabel(decision: string | null): string | null {
  return decision === null ? null : (DECISION_LABELS[decision] ?? decision);
}

/**
 * The code on the page.
 *
 * It encodes the public verification address and nothing else. Someone who photographs
 * it learns that a document with this hash was sealed by us at this time, and learns
 * nothing about whom it concerns.
 */
export async function verificationQrSvg(verifyUrl: string): Promise<string> {
  return QRCode.toString(verifyUrl, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    width: 132,
  });
}
