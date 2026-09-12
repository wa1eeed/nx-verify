/**
 * The published test data.
 *
 * A customer's QA team needs to run every case they will meet in production before they
 * meet it in production, and the only way to do that is for us to say which input produces
 * which answer. This table is that promise, and it lives beside the scenarios it
 * describes so the two cannot drift: a scenario renamed here and not there would be a
 * documented test case that does not work, which is worse than none.
 */

export interface SandboxTestCase {
  /** What the caller sends. */
  input: string;
  /** Which product this case is for. */
  productCode: string;
  /** The name a caller can force with the test scenario header. */
  scenario: string;
  titleAr: string;
  expectedAr: string;
}

export const SANDBOX_TEST_CASES: readonly SandboxTestCase[] = [
  {
    input: '7001272184',
    productCode: 'KYB_COMPLETE',
    scenario: 'success',
    titleAr: 'منشأة قائمة وملفها مكتمل',
    expectedAr: 'السجل ساري، والعنوان والإدارة والملكية كلها تُرجَع.',
  },
  {
    input: '7000000010',
    productCode: 'KYB_COMPLETE',
    scenario: 'expired_cr',
    titleAr: 'سجل تجاري منتهٍ',
    expectedAr: 'المنشأة موجودة وحالة سجلها EXPIRED. أكثر حالة حقيقية بعد الحالة النظيفة.',
  },
  {
    input: '7000000011',
    productCode: 'KYB_COMPLETE',
    scenario: 'manager_not_authorised',
    titleAr: 'مدير بلا صلاحية توقيع منفردة',
    expectedAr: 'المدير على العقد وصلاحيته مشتركة وغير مثبتة. جواب مختلف عن «غير موجود».',
  },
  {
    input: '7000000012',
    productCode: 'ADDRESS_ONLY',
    scenario: 'no_address',
    titleAr: 'منشأة بلا عنوان وطني',
    expectedAr: 'السجل ساري ولا يُرجَع عنوان. الخطوة تكتمل ولا تنتج حقولاً.',
  },
  {
    input: '7000000000',
    productCode: 'KYB_COMPLETE',
    scenario: 'not_found',
    titleAr: 'رقم لا يقابله كيان',
    expectedAr: 'NOT_FOUND، ويُحاسَب بنسبة السلبي لا مجاناً ولا كخطأ.',
  },
  {
    input: '7000000001',
    productCode: 'KYB_COMPLETE',
    scenario: 'network_error',
    titleAr: 'انقطاع قبل الوصول إلى الجهة',
    expectedAr: 'ERROR قابل لإعادة المحاولة، ولا يُحاسَب عليه أحد.',
  },
  {
    input: '7000000003',
    productCode: 'KYB_COMPLETE',
    scenario: 'incomplete',
    titleAr: 'استجابة ناقصة الحقول',
    expectedAr: 'الحالة تُرجَع والاسم ورأس المال والعنوان غائبة. الحالة التي لا يعرضها أي توثيق مزوّد.',
  },
  {
    input: 'FL-2020-00001',
    productCode: 'FREELANCER_CERTIFICATE',
    scenario: 'freelance_expired',
    titleAr: 'وثيقة عمل حر منتهية',
    expectedAr: 'الوثيقة موجودة وحالتها EXPIRED وتاريخ انتهائها في الماضي.',
  },
  {
    input: 'SA9980000000608010167599',
    productCode: 'BANK_ACCOUNT_OWNERSHIP',
    scenario: 'account_mismatch',
    titleAr: 'حساب باسم جهة أخرى',
    expectedAr: 'الحساب قائم والاسم لا يطابق، بدرجة مطابقة منخفضة. نتيجة لا خطأ.',
  },
  {
    input: '999000111222',
    productCode: 'PROPERTY_DEED',
    scenario: 'deed_encumbered',
    titleAr: 'صك عليه رهن',
    expectedAr: 'الصك ساري وعليه رهن مسجّل. الجواب الذي يسأل عنه المموّل فعلاً.',
  },
];
