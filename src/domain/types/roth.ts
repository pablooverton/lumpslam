import type { RothConversionEvent } from './simulation';

export interface RothConversionStrategy {
  targetBracketCeiling: number;
  projectedEvents: (RothConversionEvent & { year: number })[];
  totalLifetimeTaxPaid: number;
  totalConverted: number;
  estimatedTaxSavingsVsNoAction: number;
}
