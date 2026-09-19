/**
 * What the last save did, or why it was refused.
 *
 * Beside the action rather than inside it: every export of a 'use server' module must be an
 * async function, so a plain helper living there fails the build.
 */
/** What the last save did, or why it was refused. */
export function costNoticeAr(params: {
  refused?: string | undefined;
  saved?: string | undefined;
  broke?: string | undefined;
}): { tone: 'done' | 'refused'; text: string } | null {
  switch (params.refused) {
    case undefined:
      break;
    case 'role':
      return { tone: 'refused', text: 'دورك في اللوحة لا يسمح بتعديل التكاليف.' };
    case 'unknown':
      return { tone: 'refused', text: 'لا منتج تحقق يستعمل هذا النداء، فلا معنى لتسجيل تكلفته.' };
    default:
      return { tone: 'refused', text: 'لم تُحفظ: التكلفة رقم بالريال، مثل 10.00' };
  }

  if (params.saved === undefined) {
    return null;
  }
  // The prices this rate put under water, named. The cost is already recorded: this is the
  // list somebody has to go and act on, not a refusal.
  return params.broke === undefined || params.broke === ''
    ? { tone: 'done', text: 'سُجّلت التكلفة. أُغلق السعر السابق وبقي محفوظاً بتاريخه.' }
    : {
        tone: 'refused',
        text: `سُجّلت التكلفة، وصار سعر هذه المنتجات تحت تكلفتها: ${params.broke}. راجع أسعارها الآن.`,
      };
}
