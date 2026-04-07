export interface OneTimeExpense {
  year: number;
  label: string;
  amount: number;
}

export interface SpendingProfile {
  baseAnnualSpending: number;       // in today's dollars
  travelBudgetEarly: number;        // added to base in early retirement
  travelBudgetLate: number;         // tapered amount
  travelTaperStartAge: number;      // client age when travel tapers
  charitableGivingAnnual: number;
  oneTimeExpenses: OneTimeExpense[];
  inflationRate: number;            // default 0.03

  // Mortgage — fixed nominal payment (P&I only), ends at mortgagePaidOffAge.
  // NOT inflation-adjusted; a 30-yr fixed stays the same dollar amount throughout.
  // Set mortgageAnnualPayment to 0 (or omit) if no mortgage at retirement.
  mortgageAnnualPayment?: number;   // e.g. 48_800 for $48.8k/yr P&I
  mortgagePaidOffAge?: number;      // client age when last payment is made (e.g. 69)
}
