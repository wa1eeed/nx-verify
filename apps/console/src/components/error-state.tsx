'use client';

import type { ReactElement } from 'react';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Ltr } from './ui/ltr';

/**
 * A screen that could not be drawn (README, states: the reason and a retry).
 *
 * It says what did not happen and what did not change, offers the retry, and gives the code
 * support needs. It never shows the error's own message: that is written for us, and it can
 * carry what a person on this screen must not see (rule 4).
 */
export function ErrorState({
  digest,
  onRetry,
}: {
  digest?: string | undefined;
  onRetry: () => void;
}): ReactElement {
  return (
    <Card label="تعذّر عرض الصفحة">
      <div role="alert" className="stack" style={{ gap: 'var(--s-3)' }}>
        <CardTitle as="h1">تعذّر عرض هذه الصفحة</CardTitle>
        <p style={{ margin: 0 }}>
          لم تكتمل قراءة البيانات، ولم يتغيّر شيء في حسابك. أعد المحاولة، وإن تكرر الخطأ فأرسل الرمز
          أدناه إلى الدعم.
        </p>
        {digest === undefined ? null : (
          <p className="faint" style={{ margin: 0 }}>
            الرمز: <Ltr>{digest}</Ltr>
          </p>
        )}
        <div>
          <Button variant="primary" icon="refresh-cw" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      </div>
    </Card>
  );
}
