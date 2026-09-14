'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerKind } from '@nx-verify/core';
import { Button, ButtonLink } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { Segmented } from '../ui/segmented';
import { Tag } from '../ui/tag';
import { dayMonthAr, riyals, shortMask } from '../format';
import { HANDOFF_KEY } from '../home/quick-start';
import {
  KIND_OPTIONS,
  availableCountAr,
  defaultSelection,
  kindLabel,
  lookupLineAr,
  orderedProducts,
  productsCountAr,
  rowView,
  selectedCountAr,
  totalsOf,
  type LookupData,
  type NewRequestActions,
  type NewRequestView,
  type ProductData,
  type RequestCheckData,
  type RequestData,
  type RequestField,
  type RequestInput,
  type SessionResult,
} from './model';

/**
 * «طلب تحقق جديد» (handoff screen 02).
 *
 * The number and the kind of customer, the products with a row each, and the bar that runs
 * them. Pressing creates a request and returns at once; the rows then move from «قيد
 * المعالجة» to their result as each check settles, in whatever order that happens, and the
 * customer's file fills with them. What a row says, what the total is and whether the balance
 * covers it are decided in model.ts, so this file only holds the state and draws it.
 */

const POLL_MS = 1500;
const LOOKUP_DELAY_MS = 350;

type Problem = { textAr: string; field: RequestField | null };

function settled(status: RequestCheckData['status']): boolean {
  return status === 'DONE' || status === 'FAILED' || status === 'SKIPPED';
}

export function NewRequestScreen({
  view,
  actions,
}: {
  view: NewRequestView;
  actions: NewRequestActions;
}): ReactElement {
  const router = useRouter();
  // What the page was opened with. A refresh after a request settles hands in new props,
  // and must not take the rows being watched away.
  const [opened] = useState(() => ({ lookup: view.lookup, draft: view.draft }));
  const draft = opened.draft;

  const [kind, setKind] = useState<CustomerKind>(view.kind);
  const [number, setNumber] = useState('');
  const [certificate, setCertificate] = useState('');
  const [iban, setIban] = useState('');
  const [lookup, setLookup] = useState<LookupData | null>(view.lookup);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(draft?.productCodes ?? defaultSelection(view.products, view.kind)),
  );
  const [bundle, setBundle] = useState(view.bundle);
  const [draftSubmitted, setDraftSubmitted] = useState(false);
  const [requests, setRequests] = useState<ReadonlyMap<string, RequestData>>(new Map());
  const [results, setResults] = useState<ReadonlyMap<string, SessionResult>>(new Map());
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Which press is in flight, so only its button reads busy while every other one waits.
  const [busy, setBusy] = useState<string | null>(null);
  const [poll, setPoll] = useState(0);

  const lookupSequence = useRef(0);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const polling = useRef(false);

  const draftActive = draft !== null && !draftSubmitted;

  const changeKind = (next: CustomerKind): void => {
    setKind(next);
    setSelected(new Set(defaultSelection(view.products, next)));
    setResults(new Map());
    setProblem(null);
  };

  // A number handed over from the home screen's «ابدأ تحققاً جديداً», read once and cleared.
  // A number of ten digits starting 1 or 2 may be a registration or an ID: if no business
  // is on file under it, the screen asks again as a freelancer.
  const handedOver = useRef<string | null>(null);
  useEffect(() => {
    if (draft !== null) {
      return;
    }
    try {
      const handed = window.sessionStorage.getItem(HANDOFF_KEY);
      window.sessionStorage.removeItem(HANDOFF_KEY);
      if (handed !== null && handed.trim() !== '') {
        handedOver.current = handed.trim();
        setNumber(handed.trim());
        setSearching(true);
      }
    } catch {
      // Storage refused: the screen opens empty.
    }
    // Once, when the screen opens.
  }, []);

  // Who the typed number belongs to, asked once typing pauses. A later answer wins over an
  // earlier one that arrives late.
  useEffect(() => {
    if (draft !== null) {
      return undefined;
    }
    const typed = number.trim();
    const sequence = ++lookupSequence.current;
    if (typed === '') {
      setSearching(false);
      setLookup(opened.lookup);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      actions
        .lookup(kind, typed)
        .then((found) => {
          if (sequence !== lookupSequence.current) {
            return;
          }
          if (
            handedOver.current === typed &&
            found.status !== 'FOUND' &&
            kindRef.current !== 'FREELANCER' &&
            /^[12][0-9]{9}$/.test(typed)
          ) {
            handedOver.current = null;
            void actions
              .lookup('FREELANCER', typed)
              .then((person) => {
                if (sequence !== lookupSequence.current) {
                  return;
                }
                if (person.status === 'FOUND') {
                  changeKind('FREELANCER');
                } else {
                  setSearching(false);
                  setLookup(found);
                }
              })
              .catch(() => {
                setSearching(false);
                setLookup(found);
              });
            return;
          }
          setSearching(false);
          setLookup(found);
          setProblem((current) => (current?.field === 'number' ? null : current));
          // The file knows what the customer is: the products follow it.
          if (found.status === 'FOUND' && found.kind !== null && found.kind !== kindRef.current) {
            changeKind(found.kind);
          }
        })
        .catch(() => {
          if (sequence === lookupSequence.current) {
            setSearching(false);
            setProblem({ textAr: 'تعذّر البحث عن العميل الآن. أعد المحاولة.', field: null });
          }
        });
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [number, kind]);

  // How the requests pressed from here are going, until each has settled.
  useEffect(() => {
    if (![...requests.values()].some((request) => request.open)) {
      return undefined;
    }
    const timer = setTimeout(() => void pollOnce(), POLL_MS);
    return () => clearTimeout(timer);
  }, [requests, poll]);

  async function pollOnce(): Promise<void> {
    if (polling.current) {
      return;
    }
    polling.current = true;
    try {
      const open = [...requestsRef.current.values()].filter((request) => request.open);
      const updates = await Promise.all(
        open.map((request) => actions.status(request.requestId).catch(() => request)),
      );

      const newlySettled: [string, SessionResult][] = [];
      let entityId: string | null = null;
      let finished = false;
      updates.forEach((update, index) => {
        const before = open[index];
        if (update === null || before === undefined) {
          return;
        }
        entityId = update.entityId ?? entityId;
        for (const check of update.checks) {
          const previous = before.checks.find((entry) => entry.productCode === check.productCode);
          if (settled(check.status) && !(previous && settled(previous.status))) {
            newlySettled.push([
              check.productCode,
              { status: check.status, outcome: check.outcome, noteAr: check.noteAr },
            ]);
          }
        }
        finished = finished || !update.open;
      });

      setRequests((current) => {
        const next = new Map(current);
        updates.forEach((update, index) => {
          const before = open[index];
          if (update === null && before) {
            next.delete(before.requestId);
          } else if (update !== null) {
            next.set(update.requestId, update);
          }
        });
        return next;
      });

      if (newlySettled.length > 0) {
        setResults((current) => {
          const next = new Map(current);
          for (const [code, result] of newlySettled) {
            next.set(code, result);
          }
          return next;
        });
        // The file changed: read where each check stands now, conflicts included.
        if (entityId !== null) {
          const refreshed = await actions.standings(kindRef.current, entityId).catch(() => null);
          if (refreshed !== null) {
            setLookup(refreshed);
          }
        }
      }
      // The balance at the foot of the sidebar is drawn on the server.
      if (finished) {
        router.refresh();
      }
    } finally {
      polling.current = false;
      setPoll((value) => value + 1);
    }
  }

  const live = useMemo(() => {
    const map = new Map<string, RequestCheckData>();
    for (const request of requests.values()) {
      for (const check of request.checks) {
        if (check.status === 'QUEUED' || check.status === 'RUNNING') {
          map.set(check.productCode, check);
        }
      }
    }
    return map;
  }, [requests]);

  const standingOf = useMemo(
    () => new Map((lookup?.standings ?? []).map((standing) => [standing.productCode, standing])),
    [lookup],
  );

  const rows = orderedProducts(view.products, kind).map((product) => ({
    product,
    row: rowView(product, {
      kind,
      standing: standingOf.get(product.productCode),
      live: live.get(product.productCode),
      result: results.get(product.productCode),
    }),
  }));
  const offered = rows.filter(({ row }) => row.enabled);
  // A ticked product being checked stays ticked, and is not sent again.
  const tickable = rows.filter(({ row }) => row.enabled || row.running);
  const chosen = tickable
    .filter(({ product }) => selected.has(product.productCode))
    .map(({ product }) => product);
  const runnable = offered
    .filter(({ product }) => selected.has(product.productCode))
    .map(({ product }) => product);
  const allSelected =
    tickable.length > 0 && tickable.every(({ product }) => selected.has(product.productCode));
  const applicableCount = rows.filter(
    ({ product }) => product.appliesTo.includes(kind) && product.availability === 'AVAILABLE',
  ).length;
  const totals = totalsOf(runnable, lookup, view.balance);

  const accountOnFile = lookup?.accountMasked ?? draft?.ibanMasked ?? null;
  const certificateOnFile = lookup?.hasCertificate === true || draft?.hasCertificate === true;
  const ibanRow = rows.find(({ product, row }) => product.needsIban && row.applicable)?.product;
  const certificateRow = rows.find(
    ({ product, row }) => product.needsCertificate && row.applicable,
  )?.product;
  // Asked for once there is a customer to ask it about, and only when the file has none.
  const known = lookup !== null || draft !== null;
  const wantsIban =
    known && runnable.some((product) => product.needsIban) && accountOnFile === null;
  const wantsCertificate =
    known && runnable.some((product) => product.needsCertificate) && !certificateOnFile;

  function toggle(code: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(
      allSelected ? new Set() : new Set(tickable.map(({ product }) => product.productCode)),
    );
  }

  function validate(codes: readonly string[], forDraft: boolean): Problem | null {
    const picked = view.products.filter((product) => codes.includes(product.productCode));
    if (picked.length === 0) {
      return { textAr: 'اختر منتجاً واحداً على الأقل.', field: null };
    }
    if (draft === null && searching) {
      return { textAr: 'جارٍ البحث عن ملف العميل، انتظر لحظة ثم أعد المحاولة.', field: 'number' };
    }
    if (draft === null && lookup?.status !== 'FOUND') {
      if (number.trim() === '') {
        return { textAr: 'أدخل رقم السجل التجاري أو الهوية الوطنية.', field: 'number' };
      }
      if (lookup?.status === 'INVALID') {
        return { textAr: view.problemsAr.NUMBER, field: 'number' };
      }
      if (lookup?.status === 'REGISTRATION_UNKNOWN') {
        return { textAr: view.problemsAr.REGISTRATION_UNKNOWN, field: 'number' };
      }
    }
    // A draft may be saved before the IBAN or the certificate is at hand.
    if (
      !forDraft &&
      picked.some((product) => product.needsIban) &&
      iban.trim() === '' &&
      accountOnFile === null
    ) {
      return { textAr: 'أدخل رقم الآيبان لتنفيذ هذه العملية.', field: 'iban' };
    }
    if (
      !forDraft &&
      picked.some((product) => product.needsCertificate) &&
      certificate.trim() === '' &&
      !certificateOnFile
    ) {
      return { textAr: 'أدخل رقم شهادة العمل الحر لتنفيذ هذه العملية.', field: 'certificate' };
    }
    return null;
  }

  function inputFor(codes: string[], mode: 'all' | 'one'): RequestInput {
    return {
      kind,
      number: number.trim(),
      certificateNumber: certificate.trim(),
      iban: iban.trim(),
      entityId: lookup?.status === 'FOUND' ? lookup.entityId : null,
      productCodes: codes,
      bundle,
      draftId: draftActive ? draft.requestId : null,
      mode,
    };
  }

  function run(codes: string[], mode: 'all' | 'one'): void {
    setNotice(null);
    const found = validate(codes, false);
    if (found !== null) {
      setProblem(found);
      return;
    }
    setBusy(mode === 'all' ? 'all' : (codes[0] ?? null));
    startTransition(async () => {
      const result = await actions.submit(inputFor(codes, mode)).catch(() => ({
        ok: false as const,
        errorAr: 'تعذّر إرسال الطلب الآن. أعد المحاولة.',
        field: null,
      }));
      if (!result.ok) {
        setProblem({ textAr: result.errorAr, field: result.field });
        return;
      }
      setProblem(null);
      setBundle(result.nextBundle);
      if (draftActive && mode === 'all') {
        setDraftSubmitted(true);
      }
      setResults((current) => {
        const next = new Map(current);
        for (const code of codes) {
          next.delete(code);
        }
        return next;
      });
      setRequests((current) => new Map(current).set(result.request.requestId, result.request));
    });
  }

  function saveDraft(): void {
    setNotice(null);
    const codes = chosen.map((product) => product.productCode);
    const found = validate(codes, true);
    if (found !== null) {
      setProblem(found);
      return;
    }
    setBusy('draft');
    startTransition(async () => {
      const result = await actions.saveDraft(inputFor(codes, 'all')).catch(() => ({
        ok: false as const,
        errorAr: 'تعذّر حفظ المسودة الآن. أعد المحاولة.',
        field: null,
      }));
      if (!result.ok) {
        setProblem({ textAr: result.errorAr, field: result.field });
        return;
      }
      setProblem(null);
      if (draftActive) {
        setNotice('حُفظت المسودة.');
        router.refresh();
      } else {
        router.push(`/verifications/new?draft=${result.draftId}`);
      }
    });
  }

  function discard(draftId: string): void {
    setBusy(draftId);
    startTransition(async () => {
      await actions.discardDraft(draftId).catch(() => false);
      if (draft?.requestId === draftId) {
        router.push('/verifications/new');
      } else {
        router.refresh();
      }
    });
  }

  const lineProblem = problem?.field === 'number' ? problem.textAr : null;
  const lookupLine = lookupLineAr(lookup, {
    searching,
    problemAr: lineProblem,
    draft,
    problemsAr: view.problemsAr,
  });

  const samples = view.samples.filter((sample) =>
    kind === 'FREELANCER' ? sample.kind === 'FREELANCER' : sample.kind !== 'FREELANCER',
  );

  return (
    <>
      {problem !== null && problem.field === null ? (
        <p className="request-alert" role="alert" data-role="request-problem">
          {problem.textAr}
        </p>
      ) : null}

      <Card as="section" variant="flush" label="العميل" role="request-input">
        <div className="request-input">
          <Field id="request-number" label="رقم السجل التجاري أو الهوية الوطنية">
            {(control) => (
              <Input
                {...control}
                ltr
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                value={
                  draft !== null
                    ? (shortMask(draft.subjectMasked ?? lookup?.identifierMasked ?? null) ?? '')
                    : number
                }
                readOnly={draft !== null}
                invalid={lineProblem !== null}
                placeholder={shortMask(lookup?.identifierMasked ?? null) ?? undefined}
                list={samples.length > 0 && draft === null ? 'request-samples' : undefined}
                onChange={(event) => {
                  setNumber(event.target.value);
                  // Said at once, so the sentence about the last number is never read as this one's.
                  setSearching(event.target.value.trim() !== '');
                  setProblem(null);
                }}
              />
            )}
          </Field>
          <div className="field">
            <span className="field-label" aria-hidden="true">
              نوع الكيان
            </span>
            <Segmented
              name="request-kind"
              label="نوع الكيان"
              options={KIND_OPTIONS.map((option) => ({
                ...option,
                disabled: draft !== null && option.value !== draft.kind,
              }))}
              value={kind}
              onChange={changeKind}
            />
          </div>
          <p
            className="request-lookup"
            role="status"
            aria-live="polite"
            data-role="lookup"
            data-tone={lookupLine.problem ? 'problem' : undefined}
          >
            {lookupLine.textAr}
            {draft !== null ? (
              <>
                {' '}
                <Link href="/verifications/new">طلب جديد</Link>
              </>
            ) : lookup?.status === 'FOUND' && lookup.entityId !== null ? (
              <>
                {' '}
                <Link href={`/customers/${lookup.entityId}`}>فتح الملف</Link>
              </>
            ) : null}
          </p>
          {samples.length > 0 ? (
            <datalist id="request-samples">
              {samples.map((sample) => (
                <option key={`${sample.number}-${sample.titleAr}`} value={sample.number}>
                  {sample.titleAr}
                </option>
              ))}
            </datalist>
          ) : null}
        </div>
      </Card>

      <Card as="section" variant="flush" label="المنتجات" role="request-products">
        <div className="request-products-head">
          <Checkbox checked={allSelected} disabled={offered.length === 0} onChange={toggleAll}>
            اختيار كل المنتجات
          </Checkbox>
          <p className="request-products-count" data-role="available-count">
            {availableCountAr(applicableCount)}
          </p>
        </div>
        <ul className="request-rows">
          {rows.map(({ product, row }) => {
            const nameId = `product-${product.productCode}`;
            const own = totalsOf([product], lookup, view.balance);
            return (
              <li
                key={product.productCode}
                className="request-row"
                data-product={product.productCode}
                data-applicable={row.applicable ? 'yes' : 'no'}
                data-running={row.running ? 'yes' : undefined}
              >
                <Checkbox
                  checked={(row.enabled || row.running) && selected.has(product.productCode)}
                  disabled={!row.enabled}
                  aria-labelledby={nameId}
                  onChange={() => toggle(product.productCode)}
                />
                <div className="request-row-text">
                  <p className="request-row-name" id={nameId}>
                    {product.nameAr}
                  </p>
                  <p className="request-row-line">{row.lineAr}</p>
                  {row.noteAr !== null ? (
                    <p className="request-row-note" data-role="product-note">
                      {row.noteAr}
                    </p>
                  ) : null}
                  {product === ibanRow && wantsIban ? (
                    <div className="request-row-input">
                      <Field
                        id="request-iban"
                        label="رقم الآيبان"
                        error={problem?.field === 'iban' ? problem.textAr : undefined}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            ltr
                            autoComplete="off"
                            maxLength={34}
                            placeholder="SA"
                            value={iban}
                            invalid={problem?.field === 'iban'}
                            onChange={(event) => {
                              setIban(event.target.value);
                              setProblem(null);
                            }}
                          />
                        )}
                      </Field>
                    </div>
                  ) : null}
                  {product === certificateRow && wantsCertificate ? (
                    <div className="request-row-input">
                      <Field
                        id="request-certificate"
                        label="رقم شهادة العمل الحر"
                        error={problem?.field === 'certificate' ? problem.textAr : undefined}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            ltr
                            autoComplete="off"
                            maxLength={20}
                            placeholder="FL-"
                            value={certificate}
                            invalid={problem?.field === 'certificate'}
                            onChange={(event) => {
                              setCertificate(event.target.value);
                              setProblem(null);
                            }}
                          />
                        )}
                      </Field>
                    </div>
                  ) : null}
                </div>
                <Tag tone={row.tag.tone} role="product-state">
                  {row.tag.text}
                </Tag>
                {view.showPrices ? (
                  <span className="request-row-price" data-role="product-price">
                    {product.unitPriceHalalas === null ? null : (
                      <>
                        <Ltr>{riyals(product.unitPriceHalalas)}</Ltr> ر.س
                      </>
                    )}
                  </span>
                ) : null}
                <Button
                  onClick={() => run([product.productCode], 'one')}
                  disabled={!row.enabled || !own.affordable || pending}
                  pending={pending && busy === product.productCode}
                  aria-label={`${row.buttonLabel}: ${product.nameAr}`}
                  data-role="verify-product"
                >
                  {row.buttonLabel}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card as="section" variant="flush" tone="accent-2" label="تأكيد الطلب" role="request-bar">
        <div className="request-bar">
          <div className="request-bar-text">
            <p className="request-bar-title" data-role="selected-count">
              {selectedCountAr(chosen.length)}
            </p>
            {runnable.length > 0 && !totals.affordable ? (
              <p className="request-bar-line" data-tone="problem" data-role="balance-problem">
                الرصيد لا يكفي لهذه العمليات. اشحن الرصيد ثم أعد المحاولة.
              </p>
            ) : view.showPrices && runnable.length > 0 ? (
              <p className="request-bar-line" data-role="total">
                {totals.lineAr}
              </p>
            ) : null}
            {notice !== null ? (
              <p className="request-bar-line" role="status">
                {notice}
              </p>
            ) : null}
          </div>
          {runnable.length > 0 && !totals.affordable ? (
            <ButtonLink href="/billing" data-role="buy-credit">
              شراء رصيد
            </ButtonLink>
          ) : null}
          {draftSubmitted ? null : (
            <Button
              onClick={saveDraft}
              pending={pending && busy === 'draft'}
              disabled={chosen.length === 0 || pending}
              data-role="save-draft"
            >
              حفظ كمسودة
            </Button>
          )}
          <Button
            variant="primary"
            icon="badge-check"
            wide
            onClick={() =>
              run(
                runnable.map((product) => product.productCode),
                'all',
              )
            }
            pending={pending && busy === 'all'}
            disabled={runnable.length === 0 || !totals.affordable || pending}
            data-role="verify-all"
          >
            تحقق من الكل
          </Button>
        </div>
      </Card>

      {view.drafts.length > 0 ? (
        <Card as="section" label="المسودات المحفوظة" role="request-drafts">
          <div className="request-drafts">
            <CardTitle as="h2">المسودات المحفوظة</CardTitle>
            <ul className="request-draft-list">
              {view.drafts.map((entry) => (
                <li key={entry.requestId} className="request-draft" data-draft={entry.requestId}>
                  <span className="request-draft-label">
                    {entry.label.includes('•') ? <Ltr>{shortMask(entry.label)}</Ltr> : entry.label}{' '}
                    <span className="request-draft-meta">
                      · {kindLabel(entry.kind)} · {productsCountAr(entry.productCount)} ·{' '}
                      {dayMonthAr(new Date(entry.createdAt))}
                    </span>
                  </span>
                  {draft?.requestId === entry.requestId ? (
                    <Tag tone="accent-2">مفتوحة الآن</Tag>
                  ) : (
                    <ButtonLink
                      variant="ghost"
                      href={`/verifications/new?draft=${entry.requestId}`}
                    >
                      متابعة
                    </ButtonLink>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => discard(entry.requestId)}
                    pending={pending && busy === entry.requestId}
                    disabled={pending}
                    aria-label={`حذف مسودة ${entry.label.includes('•') ? (shortMask(entry.label) ?? '') : entry.label}`}
                  >
                    حذف
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
    </>
  );
}

export type { NewRequestView, NewRequestActions, ProductData };
