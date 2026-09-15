import type { ReactElement, ReactNode } from 'react';
import type { CustomerFile } from '@nx-verify/core';
import { dateAr, shortMask } from '../format';
import { Card } from '../ui/card';
import { CompletenessRing } from '../ui/completeness-ring';
import { Ltr } from '../ui/ltr';
import { Tag } from '../ui/tag';
import { reasonsCountAr } from './values';

/**
 * The head of a customer file and the strip of four figures under it (README, screen 03).
 *
 * The name with the kind of customer and its number beside it, when the file was opened and
 * last verified, and the actions facing them. Then how complete the file is, where the
 * business or the freelancer stands, how many of the people behind it are verified, and the
 * risk score, each with the line that explains it.
 */

export function FileHeader({
  file,
  actions,
}: {
  file: CustomerFile;
  actions: ReactNode;
}): ReactElement {
  return (
    <header className="page-head" data-role="header">
      <div className="page-head-text">
        <div className="file-head-title">
          <h1 className="page-title">{file.displayName ?? 'عميل بلا اسم بعد'}</h1>
          <Tag tone="brand" role="classification">
            {file.kindLabelAr}
          </Tag>
          {file.primaryIdentifier ? (
            <Tag role="primary-identifier">
              {file.primaryIdentifier.labelAr}{' '}
              <Ltr>{shortMask(file.primaryIdentifier.display)}</Ltr>
            </Tag>
          ) : null}
        </div>
        <p className="page-subtitle">
          أُنشئ الملف في {dateAr(file.createdAt)}
          {file.lastVerifiedAt ? ` · آخر تحقق ${dateAr(file.lastVerifiedAt)}` : ' · لم يُتحقق بعد'}
        </p>
      </div>
      <div className="page-head-actions">{actions}</div>
    </header>
  );
}

export function IndicatorStrip({ file }: { file: CustomerFile }): ReactElement {
  const { assessment, kyc } = file;
  const failing = assessment.items.find((item) => item.state === 'FAIL' || item.state === 'WARN');
  const passed = assessment.items
    .filter((item) => item.state === 'PASS')
    .map((item) => item.shortAr)
    .slice(0, 3)
    .join(' · ');

  return (
    <section className="file-strip" aria-label="مؤشرات الملف" data-role="headline">
      <Card as="div" variant="stat" role="completeness">
        <div className="strip-ring">
          <CompletenessRing percent={file.completeness} label="اكتمال الملف" />
          <div>
            <p className="strip-value">
              <Ltr>{file.completeness}%</Ltr>
            </p>
            <p className="strip-label">اكتمال الملف</p>
            <p className="strip-line">
              <Ltr>{file.sectionsDone}</Ltr> من <Ltr>{file.sectionsRequired}</Ltr> أقسام
            </p>
          </div>
        </div>
      </Card>

      <Card
        as="div"
        variant="stat"
        tone={
          assessment.standing === 'COMPLETE'
            ? 'accent-2'
            : assessment.standing === 'DEFICIENT'
              ? 'accent'
              : 'surface'
        }
        role="standing"
      >
        <p className="strip-label">
          {assessment.mode} · {assessment.mode === 'KYB' ? 'الكيان' : 'العامل الحر'}
        </p>
        <p className="strip-value" data-role="standing">
          {assessment.standingAr}
        </p>
        <p className="strip-line">{failing?.detailAr ?? (passed || 'لم يُتحقق من شيء بعد')}</p>
      </Card>

      <Card as="div" variant="stat" role="kyc">
        <p className="strip-label">KYC · الأشخاص</p>
        <p className="strip-value">
          <Ltr>{kyc.verified}</Ltr> من <Ltr>{kyc.total}</Ltr>
        </p>
        <p className="strip-line">{kyc.lineAr}</p>
      </Card>

      <Card
        as="div"
        variant="stat"
        tone={
          assessment.riskLevel === 'LOW'
            ? 'accent-2'
            : assessment.riskLevel === 'INCOMPLETE'
              ? 'surface'
              : 'accent'
        }
        role="risk-summary"
      >
        <p className="strip-label">درجة المخاطر</p>
        <p className="strip-value" data-role="risk-level">
          {assessment.riskScore === null ? (
            assessment.riskLabelAr
          ) : (
            <>
              {assessment.riskLabelAr} · <Ltr>{assessment.riskScore}</Ltr>
            </>
          )}
        </p>
        <p className="strip-line">
          {assessment.riskScore === null ? (
            'تُقدَّر بعد أول تحقق'
          ) : (
            <>
              {reasonsCountAr(assessment.riskReasons.length)} ·{' '}
              <a href="#risk">انظر لوحة المخاطر</a>
            </>
          )}
        </p>
      </Card>
    </section>
  );
}
