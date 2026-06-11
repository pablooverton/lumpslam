export interface StateBracket {
  rate: number;
  ceilingMFJ: number;   // Infinity for the top step
  ceilingSingle: number;
}

export interface StateInfo {
  name: string;
  abbreviation: string;
  hasIncomeTax: boolean;
  topMarginalRate: number; // approximate; for planning reference only
  /** Optional coarse progressive steps (2–4, planning-grade, 2025-era). When present,
   *  calculateStateTax uses these instead of flat topMarginalRate — fixes the "CA charges
   *  13.3% on every dollar" class of error for the big progressive states. Deliberately
   *  approximate (±~0.5pp effective); no state standard deductions/exemptions modeled,
   *  which leans conservative. Flat-tax states stay on topMarginalRate. */
  brackets?: StateBracket[];
}

/** State income tax on a taxable base. Progressive steps when the state defines them;
 *  flat topMarginalRate otherwise (the long-standing planning approximation — NC keeps a
 *  deliberately conservative flat 4.5% vs the actual 3.99%→~3% phase-down). */
export function calculateStateTax(
  state: StateInfo | undefined,
  taxableBase: number,
  filingStatus: 'married_filing_jointly' | 'single'
): number {
  if (!state || !state.hasIncomeTax || taxableBase <= 0) return 0;
  if (!state.brackets || state.brackets.length === 0) return taxableBase * state.topMarginalRate;
  let remaining = taxableBase;
  let tax = 0;
  let prevCeiling = 0;
  for (const bracket of state.brackets) {
    const ceiling = filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
    const inBracket = Math.min(remaining, ceiling - prevCeiling);
    tax += inBracket * bracket.rate;
    remaining -= inBracket;
    prevCeiling = ceiling;
    if (remaining <= 0) break;
  }
  return tax;
}

export const US_STATES: StateInfo[] = [
  { name: 'Alabama',        abbreviation: 'AL', hasIncomeTax: true,  topMarginalRate: 0.050 },
  { name: 'Alaska',         abbreviation: 'AK', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Arizona',        abbreviation: 'AZ', hasIncomeTax: true,  topMarginalRate: 0.025 },
  { name: 'Arkansas',       abbreviation: 'AR', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'California',     abbreviation: 'CA', hasIncomeTax: true,  topMarginalRate: 0.133, brackets: [
    { rate: 0.030, ceilingMFJ: 100_000, ceilingSingle: 50_000 },
    { rate: 0.080, ceilingMFJ: 140_000, ceilingSingle: 70_000 },
    { rate: 0.093, ceilingMFJ: 700_000, ceilingSingle: 350_000 },
    { rate: 0.123, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Colorado',       abbreviation: 'CO', hasIncomeTax: true,  topMarginalRate: 0.044 },
  { name: 'Connecticut',    abbreviation: 'CT', hasIncomeTax: true,  topMarginalRate: 0.069, brackets: [
    { rate: 0.030, ceilingMFJ: 100_000, ceilingSingle: 50_000 },
    { rate: 0.055, ceilingMFJ: 200_000, ceilingSingle: 100_000 },
    { rate: 0.065, ceilingMFJ: 500_000, ceilingSingle: 250_000 },
    { rate: 0.0699, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Delaware',       abbreviation: 'DE', hasIncomeTax: true,  topMarginalRate: 0.066 },
  { name: 'Florida',        abbreviation: 'FL', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Georgia',        abbreviation: 'GA', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'Hawaii',         abbreviation: 'HI', hasIncomeTax: true,  topMarginalRate: 0.110, brackets: [
    { rate: 0.050, ceilingMFJ: 50_000, ceilingSingle: 25_000 },
    { rate: 0.075, ceilingMFJ: 100_000, ceilingSingle: 50_000 },
    { rate: 0.090, ceilingMFJ: 300_000, ceilingSingle: 150_000 },
    { rate: 0.110, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Idaho',          abbreviation: 'ID', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Illinois',       abbreviation: 'IL', hasIncomeTax: true,  topMarginalRate: 0.049 },
  { name: 'Indiana',        abbreviation: 'IN', hasIncomeTax: true,  topMarginalRate: 0.031 },
  { name: 'Iowa',           abbreviation: 'IA', hasIncomeTax: true,  topMarginalRate: 0.057 },
  { name: 'Kansas',         abbreviation: 'KS', hasIncomeTax: true,  topMarginalRate: 0.057 },
  { name: 'Kentucky',       abbreviation: 'KY', hasIncomeTax: true,  topMarginalRate: 0.045 },
  { name: 'Louisiana',      abbreviation: 'LA', hasIncomeTax: true,  topMarginalRate: 0.030 },
  { name: 'Maine',          abbreviation: 'ME', hasIncomeTax: true,  topMarginalRate: 0.075, brackets: [
    { rate: 0.058, ceilingMFJ: 53_000, ceilingSingle: 26_500 },
    { rate: 0.0675, ceilingMFJ: 125_000, ceilingSingle: 62_500 },
    { rate: 0.0715, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Maryland',       abbreviation: 'MD', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Massachusetts',  abbreviation: 'MA', hasIncomeTax: true,  topMarginalRate: 0.090 },
  { name: 'Michigan',       abbreviation: 'MI', hasIncomeTax: true,  topMarginalRate: 0.043 },
  { name: 'Minnesota',      abbreviation: 'MN', hasIncomeTax: true,  topMarginalRate: 0.099, brackets: [
    { rate: 0.0535, ceilingMFJ: 46_000, ceilingSingle: 32_000 },
    { rate: 0.068, ceilingMFJ: 184_000, ceilingSingle: 104_000 },
    { rate: 0.0785, ceilingMFJ: 321_000, ceilingSingle: 193_000 },
    { rate: 0.0985, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Mississippi',    abbreviation: 'MS', hasIncomeTax: true,  topMarginalRate: 0.047 },
  { name: 'Missouri',       abbreviation: 'MO', hasIncomeTax: true,  topMarginalRate: 0.048 },
  { name: 'Montana',        abbreviation: 'MT', hasIncomeTax: true,  topMarginalRate: 0.059 },
  { name: 'Nebraska',       abbreviation: 'NE', hasIncomeTax: true,  topMarginalRate: 0.066 },
  { name: 'Nevada',         abbreviation: 'NV', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'New Hampshire',  abbreviation: 'NH', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'New Jersey',     abbreviation: 'NJ', hasIncomeTax: true,  topMarginalRate: 0.108, brackets: [
    { rate: 0.0175, ceilingMFJ: 50_000, ceilingSingle: 35_000 },
    { rate: 0.035, ceilingMFJ: 80_000, ceilingSingle: 40_000 },
    { rate: 0.055, ceilingMFJ: 150_000, ceilingSingle: 75_000 },
    { rate: 0.0637, ceilingMFJ: 500_000, ceilingSingle: 500_000 },
    { rate: 0.1075, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'New Mexico',     abbreviation: 'NM', hasIncomeTax: true,  topMarginalRate: 0.059 },
  { name: 'New York',       abbreviation: 'NY', hasIncomeTax: true,  topMarginalRate: 0.109, brackets: [
    { rate: 0.0525, ceilingMFJ: 160_000, ceilingSingle: 80_000 },
    { rate: 0.060, ceilingMFJ: 325_000, ceilingSingle: 215_000 },
    { rate: 0.0685, ceilingMFJ: 2_155_000, ceilingSingle: 1_077_000 },
    { rate: 0.109, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'North Carolina', abbreviation: 'NC', hasIncomeTax: true,  topMarginalRate: 0.045 },
  { name: 'North Dakota',   abbreviation: 'ND', hasIncomeTax: true,  topMarginalRate: 0.025 },
  { name: 'Ohio',           abbreviation: 'OH', hasIncomeTax: true,  topMarginalRate: 0.035 },
  { name: 'Oklahoma',       abbreviation: 'OK', hasIncomeTax: true,  topMarginalRate: 0.048 },
  { name: 'Oregon',         abbreviation: 'OR', hasIncomeTax: true,  topMarginalRate: 0.099, brackets: [
    { rate: 0.0475, ceilingMFJ: 17_000, ceilingSingle: 8_500 },
    { rate: 0.0675, ceilingMFJ: 43_000, ceilingSingle: 21_500 },
    { rate: 0.0875, ceilingMFJ: 250_000, ceilingSingle: 125_000 },
    { rate: 0.099, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Pennsylvania',   abbreviation: 'PA', hasIncomeTax: true,  topMarginalRate: 0.031 },
  { name: 'Rhode Island',   abbreviation: 'RI', hasIncomeTax: true,  topMarginalRate: 0.060 },
  { name: 'South Carolina', abbreviation: 'SC', hasIncomeTax: true,  topMarginalRate: 0.065 },
  { name: 'South Dakota',   abbreviation: 'SD', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Tennessee',      abbreviation: 'TN', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Texas',          abbreviation: 'TX', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Utah',           abbreviation: 'UT', hasIncomeTax: true,  topMarginalRate: 0.047 },
  { name: 'Vermont',        abbreviation: 'VT', hasIncomeTax: true,  topMarginalRate: 0.088, brackets: [
    { rate: 0.0335, ceilingMFJ: 79_000, ceilingSingle: 47_000 },
    { rate: 0.066, ceilingMFJ: 191_000, ceilingSingle: 114_000 },
    { rate: 0.076, ceilingMFJ: 291_000, ceilingSingle: 237_000 },
    { rate: 0.0875, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Virginia',       abbreviation: 'VA', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Washington',     abbreviation: 'WA', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'West Virginia',  abbreviation: 'WV', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'Wisconsin',      abbreviation: 'WI', hasIncomeTax: true,  topMarginalRate: 0.077, brackets: [
    { rate: 0.044, ceilingMFJ: 38_000, ceilingSingle: 29_000 },
    { rate: 0.053, ceilingMFJ: 420_000, ceilingSingle: 315_000 },
    { rate: 0.0765, ceilingMFJ: Infinity, ceilingSingle: Infinity },
  ] },
  { name: 'Wyoming',        abbreviation: 'WY', hasIncomeTax: false, topMarginalRate: 0 },
];

export function getStateInfo(abbreviationOrName: string): StateInfo | undefined {
  return US_STATES.find(
    (s) =>
      s.abbreviation === abbreviationOrName ||
      s.name.toLowerCase() === abbreviationOrName.toLowerCase()
  );
}
