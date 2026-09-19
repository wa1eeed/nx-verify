/**
 * What the last settlement did, or why it was refused.
 *
 * Beside the action rather than inside it: every export of a 'use server' module must be an
 * async function, so a plain helper living there fails the build.
 */
/** What the last settlement did, or why it was refused. */
export function topUpNoticeAr(params: {
  refused?: string | undefined;
  saved?: string | undefined;
}): { tone: 'done' | 'refused'; text: string } | null {
  switch (params.refused) {
    case undefined:
      break;
    case 'invoice':
      return {
        tone: 'refused',
        text: 'لم يُؤكَّد: المنصة مسجّلة في الضريبة، والتأكيد يحتاج رقم الفاتورة الضريبية.',
      };
    case 'settled':
      return { tone: 'refused', text: 'هذا الطلب لم يعد بانتظار التأكيد. حدّث الصفحة.' };
    default:
      return { tone: 'refused', text: 'لم يُنفَّذ الإجراء. حدّث الصفحة وحاول مرة أخرى.' };
  }

  switch (params.saved) {
    case 'confirmed':
      return { tone: 'done', text: 'أُكّد التحويل وأُضيف الرصيد إلى محفظة المشترك.' };
    case 'rejected':
      return { tone: 'done', text: 'سُجّل أن التحويل لم يصل. لم يتغير رصيد المشترك.' };
    default:
      return null;
  }
}
