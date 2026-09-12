/**
 * What a confidence score means, in words.
 *
 * A number on its own is not a decision. Every reader of a profile silently invents
 * thresholds for it, and two readers invent different ones: 71 is reassuring to the
 * analyst who onboarded the merchant and alarming to the one reviewing the payout. So the
 * bands are written down once, here, in the domain rather than in a stylesheet, and the
 * screen and the API read the same table.
 *
 * The bands are about our knowledge, not about the subject. A weak band says we know too
 * little or what we know is too old, and never that the company is bad. Naming them any
 * other way would turn a freshness measure into a credit opinion, which is not a thing
 * this platform is licensed to publish.
 */

export type TrustBand = 'STRONG' | 'ADEQUATE' | 'THIN' | 'INSUFFICIENT';

export interface TrustBandView {
  band: TrustBand;
  labelAr: string;
  /** What the reader should do about it, in one line. */
  hintAr: string;
  /** The token family the screen paints it with. Never a literal colour. */
  tone: 'fresh' | 'changed' | 'expired' | 'critical';
  /** Lowest score that still falls in this band. */
  floor: number;
}

const BANDS: readonly TrustBandView[] = [
  {
    band: 'STRONG',
    labelAr: 'معرفة كاملة وحديثة',
    hintAr: 'كل ما يلزم لاتخاذ قرار موجود وساري.',
    tone: 'fresh',
    floor: 80,
  },
  {
    band: 'ADEQUATE',
    labelAr: 'معرفة كافية',
    hintAr: 'يكفي لقرار روتيني. راجع الحقول المنتهية قبل قرار كبير.',
    tone: 'changed',
    floor: 60,
  },
  {
    band: 'THIN',
    labelAr: 'معرفة ناقصة',
    hintAr: 'حقول مهمة غائبة أو قديمة. أعد التحقق قبل الاعتماد عليها.',
    tone: 'expired',
    floor: 35,
  },
  {
    band: 'INSUFFICIENT',
    labelAr: 'معرفة غير كافية',
    hintAr: 'لا تُبنى قرارات على هذا الملف بحالته. شغّل تحققاً كاملاً.',
    tone: 'critical',
    floor: 0,
  },
];

/** The band a score falls in. A score of null has no band, which is not the same as zero. */
export function trustBandFor(score: number | null): TrustBandView | null {
  if (score === null) {
    return null;
  }
  // Ordered high to low, so the first floor the score clears is its band.
  return BANDS.find((band) => score >= band.floor) ?? BANDS[BANDS.length - 1] ?? null;
}

export function trustBands(): readonly TrustBandView[] {
  return BANDS;
}
