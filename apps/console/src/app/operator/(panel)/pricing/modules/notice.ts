import { count } from '../../../../../components/format';

/**
 * What the last change to a module's default did, or why it was refused.
 *
 * Beside the action rather than inside it: every export of a 'use server' module must be an
 * async function, so a plain helper living there fails the build.
 */
export function moduleNoticeAr(params: {
  refused?: string | undefined;
  saved?: string | undefined;
  name?: string | undefined;
  moved?: string | undefined;
}): { tone: 'done' | 'refused'; text: string } | null {
  switch (params.refused) {
    case undefined:
      break;
    case 'role':
      return { tone: 'refused', text: 'دورك في اللوحة لا يسمح بتعديل فهرس الوحدات.' };
    case 'core':
      return {
        tone: 'refused',
        text: 'لم يُحفظ: هذه الوحدة أساس كل ملف عميل، وهي مفعّلة للجميع ولا يكون لها افتراضي آخر.',
      };
    default:
      return { tone: 'refused', text: 'لم يُحفظ: لا توجد وحدة بهذا الرمز.' };
  }

  if (params.saved === undefined) {
    return null;
  }
  const name = params.name ?? 'الوحدة';
  if (params.saved === 'unchanged') {
    return { tone: 'done', text: `«${name}» كانت على هذا الافتراضي أصلاً، فلم يتغيّر شيء.` };
  }

  // The number carries the sentence. A default is not a setting that only touches future
  // subscribers: nothing is copied onto a workspace at onboarding, so saving it moves everybody
  // who was inheriting, at once. Saying how many afterwards is the least a screen owes them.
  const moved = Number(params.moved ?? '0');
  const who =
    moved === 0
      ? 'ولا أحد يأخذها من الافتراضي اليوم، فلم تتغيّر إجابة أحد'
      : `وتغيّرت بها إجابة ${count(moved)} من المشتركين ممن يأخذونها من الافتراضي`;

  return {
    tone: 'done',
    text:
      params.saved === 'on'
        ? `صارت «${name}» تُمنح افتراضياً، ${who}.`
        : `صارت «${name}» لا تُمنح إلا بقرار، ${who}.`,
  };
}
