// Foreign tax constants (Japan, Korea, Taiwan).
//
// All bracket thresholds are in local currency; engine functions in foreign-tax.ts handle
// USD conversion. Exchange rates here are 2026 defaults — overridable via regime parameters
// if currency stress-testing becomes needed.
//
// Sources noted per constant. Update annually as foreign tax law changes.

// ─── Default exchange rates (2026, approximate) ──────────────────────────────
// These convert USD inputs to local currency for bracket comparison.
// Real planning should stress-test multiple rates (yen could strengthen from 145 to 110, etc.)
export const DEFAULT_JPY_PER_USD = 145; // Mid-2026 approximate
export const DEFAULT_KRW_PER_USD = 1350; // Mid-2026 approximate
export const DEFAULT_TWD_PER_USD = 31.4; // Mid-2026 approximate

// ─── Japan personal income tax brackets (2026 schedule, approximate) ─────────
// Source: National Tax Agency (NTA) Japan. Simplified for planning.
// Resident tax (10% flat) is added separately as JAPAN_RESIDENT_TAX_RATE.
export interface ProgressiveBracket {
  /** Income floor (inclusive) in local currency. */
  floor: number;
  /** Marginal rate as decimal (e.g., 0.20 for 20%). */
  rate: number;
}

export const JAPAN_NATIONAL_INCOME_TAX_BRACKETS: ProgressiveBracket[] = [
  { floor: 0, rate: 0.05 },
  { floor: 1_950_000, rate: 0.10 },
  { floor: 3_300_000, rate: 0.20 },
  { floor: 6_950_000, rate: 0.23 },
  { floor: 9_000_000, rate: 0.33 },
  { floor: 18_000_000, rate: 0.40 },
  { floor: 40_000_000, rate: 0.45 },
];

/** Japanese resident tax (local) — flat 10% on top of national. */
export const JAPAN_RESIDENT_TAX_RATE = 0.10;

// ─── Korea personal income tax brackets (2026 schedule, approximate) ─────────
// Source: National Tax Service (NTS) Korea. Simplified for planning.
// Local tax surcharge (10% of national tax) added separately.
export const KOREA_NATIONAL_INCOME_TAX_BRACKETS: ProgressiveBracket[] = [
  { floor: 0, rate: 0.06 },
  { floor: 14_000_000, rate: 0.15 },
  { floor: 50_000_000, rate: 0.24 },
  { floor: 88_000_000, rate: 0.35 },
  { floor: 150_000_000, rate: 0.38 },
  { floor: 300_000_000, rate: 0.40 },
  { floor: 500_000_000, rate: 0.42 },
  { floor: 1_000_000_000, rate: 0.45 },
];

/** Korean local income tax surcharge — 10% of national tax owed. */
export const KOREA_LOCAL_TAX_SURCHARGE = 0.10;

// ─── Taiwan Income Basic Tax (AMT) parameters (2026, per MOF) ────────────────
// Source: Ministry of Finance Taiwan, 2026 announcement; values unchanged from 2025.
export const TAIWAN_BASIC_INCOME_EXEMPTION_TWD = 7_500_000;
/** Minimum foreign-source income threshold to be included in Basic Income calculation. */
export const TAIWAN_FOREIGN_SOURCE_INCLUSION_THRESHOLD_TWD = 1_000_000;
/** AMT rate applied to Basic Income above the exemption. */
export const TAIWAN_AMT_RATE = 0.20;
