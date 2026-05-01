export interface OneTimeExpense {
  year: number;
  label: string;
  amount: number;
}

// One-time cash injection (e.g. house sale proceeds at retirement, inheritance).
// Lands in brokerage at the specified year, before that year's withdrawals/conversions.
// `taxable: true` means the engine treats the amount as ordinary income for that year
// (rare — most use cases are post-tax proceeds like a primary-residence sale under §121).
export interface OneTimeIncome {
  year: number;
  label: string;
  amount: number;        // in today's real dollars
  taxable?: boolean;     // default false (post-tax proceeds)
}

export interface SpendingProfile {
  baseAnnualSpending: number;       // in today's dollars
  travelBudgetEarly: number;        // added to base in early retirement
  travelBudgetLate: number;         // tapered amount
  travelTaperStartAge: number;      // client age when travel tapers
  charitableGivingAnnual: number;
  oneTimeExpenses: OneTimeExpense[];
  oneTimeIncomes?: OneTimeIncome[]; // optional cash injections (house sale, inheritance, etc.)
  inflationRate: number;            // default 0.03

  // Mortgage — fixed nominal payment (P&I only), ends at mortgagePaidOffAge.
  // NOT inflation-adjusted; a 30-yr fixed stays the same dollar amount throughout.
  // Set mortgageAnnualPayment to 0 (or omit) if no mortgage at retirement.
  mortgageAnnualPayment?: number;   // e.g. 48_800 for $48.8k/yr P&I
  mortgagePaidOffAge?: number;      // client age when last payment is made (e.g. 69)

  // HSA healthcare routing — if set, this amount is drawn from HSA first before
  // hitting the spending pool. Do NOT include this cost in baseAnnualSpending.
  // Covers Medicare Part B/D/Medigap (ACA premiums in the pre-Medicare bridge typically
  // belong in baseAnnualSpending instead, since they're not HSA-eligible).
  annualHealthcareCost?: number;    // e.g. 15_000 for Medicare + Medigap

  // Age at which annualHealthcareCost begins. Defaults to 65 (Medicare). For long
  // pre-Medicare bridges (retire at 55), keeping this at 65 avoids charging the HSA
  // for healthcare during years when ACA is the actual coverage and is paid from
  // baseAnnualSpending. Set to retirement age if your healthcareCost truly starts
  // at retirement (e.g. private health insurance abroad).
  healthcareStartAge?: number;      // default 65

  // Running HSA-eligible healthcare spend (real dollars, applies always — accumulation
  // and retirement). Covers deductibles, copays, dental, vision, OTC qualifying expenses.
  // Drains HSA every year regardless of healthcareStartAge. Real households spend their
  // HSA down continuously even while contributing; setting this to 0 (default) treats the
  // HSA as a pure investment vehicle, which overstates terminal HSA balance.
  // Typical: $3-5k/yr for a family of 4-6 with employer coverage.
  hsaAnnualSpending?: number;

  // Annual healthcare budget when client.healthcareCoverage === 'self_insure'. Applied to the
  // pre-Medicare window only (the post-65 budget is annualHealthcareCost, same as standard).
  // Real (today's) dollars; inflates yearly during retirement. Examples for sizing:
  //   ~$0–$3k    direct primary care + cash-pay routine
  //   ~$5–$8k    health-share membership (Samaritan, Medi-Share)
  //   ~$15–25k   CrowdHealth-style catastrophic-mimicking program (event/year cap)
  //   + medical-tourism budget for planned surgeries (10× discount on US sticker price)
  // Default: 0 (treats self-insure as pure self-pay with no recurring premium).
  selfInsuranceAnnualBudget?: number;
}
