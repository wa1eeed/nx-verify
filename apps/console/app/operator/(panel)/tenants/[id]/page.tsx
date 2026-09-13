import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSubscriberDetail } from '@nx-verify/core';
import { OperatorTenantDetail } from '../../../../../components/operator-tenants';
import { operatorQuery, requireOperator } from '../../../../../lib/operator';

/** Never prerendered, and refuses to render without an operator sign in. */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OperatorTenantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  await requireOperator();
  const { id } = await params;
  // Checked before the query, so a mistyped address is a missing page rather than a
  // database error about a malformed uuid.
  if (!UUID.test(id)) {
    notFound();
  }

  const detail = await operatorQuery((db) => getSubscriberDetail(db, id));
  if (!detail) {
    notFound();
  }

  return <OperatorTenantDetail view={detail} />;
}
