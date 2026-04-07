'use client';

import { useState, useEffect, useRef } from 'react';
import { useProfileStore } from '@/store/profile.store';
import { useSimulationStore } from '@/store/simulation.store';
import { deriveAssetTotals } from '@/domain/types/assets';
import type { ClientProfile, PersonProfile } from '@/domain/types/profile';
import type { Account } from '@/domain/types/assets';
import type { SpendingProfile, OneTimeExpense } from '@/domain/types/spending';
import { formatCurrency } from '@/lib/format';
import { US_STATES, getStateInfo } from '@/domain/constants/states';
import { useRouter } from 'next/navigation';

// ─── Demo defaults (Mike & Laura) ────────────────────────────────────────────

const DEMO_PROFILE: ClientProfile = {
  client: {
    name: 'Mike',
    age: 59,
    birthYear: 1966,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 3_200,
    socialSecurityClaimAge: 68,
  },
  spouse: {
    name: 'Laura',
    age: 61,
    birthYear: 1964,
    lifeExpectancy: 95,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_800,
    socialSecurityClaimAge: 68,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 12,
};

const DEMO_ACCOUNTS: Account[] = [
  { id: '1', label: "Mike's IRA", owner: 'client', type: 'pretax_ira', currentBalance: 800_000 },
  { id: '2', label: "Laura's IRA", owner: 'spouse', type: 'pretax_ira', currentBalance: 900_000 },
  { id: '3', label: 'Joint Brokerage', owner: 'joint', type: 'brokerage', currentBalance: 250_000, costBasis: 175_000 },
  { id: '4', label: 'Inherited IRA', owner: 'client', type: 'inherited_ira', currentBalance: 100_000, isInherited: true, inheritedIraRemainingYears: 8 },
];

const DEMO_SPENDING: SpendingProfile = {
  baseAnnualSpending: 126_000,
  travelBudgetEarly: 25_000,
  travelBudgetLate: 12_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 10_000,
  oneTimeExpenses: [
    { year: 2027, label: "Son's wedding", amount: 25_000 },
    { year: 2030, label: 'Roof replacement', amount: 18_000 },
  ],
  inflationRate: 0.03,
};

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  client: PersonProfile;
  hasSpouse: boolean;
  spouse: PersonProfile;
  filingStatus: 'married_filing_jointly' | 'single';
  stateAbbreviation: string;
  hasStateIncomeTax: boolean;
  currentYear: number;
  retirementYearDesired: number;
  accounts: Account[];
  homeEquity: number;
  essentialAnnualSpending: number;   // maps to baseAnnualSpending
  lifestyleSpendingActive: number;   // maps to travelBudgetEarly
  lifestyleSpendingSlower: number;   // maps to travelBudgetLate
  lifestyleTaperAge: number;         // maps to travelTaperStartAge
  charitableGivingAnnual: number;
  oneTimeExpenses: OneTimeExpense[];
  inflationRate: number;
  mortgageAnnualPayment: number;   // 0 = no mortgage
  mortgagePaidOffAge: number;      // client age at payoff
}

const BLANK_PERSON: PersonProfile = {
  name: '',
  age: 0,
  birthYear: 0,
  lifeExpectancy: 90,
  fullRetirementAge: 67,
  fraMonthlyBenefit: 0,
  socialSecurityClaimAge: 67,
};

function buildFormState(
  profile: ClientProfile | null,
  accounts: Account[],
  homeEquity: number,
  spending: SpendingProfile | null,
): FormState {
  return {
    client: profile?.client ?? { ...BLANK_PERSON },
    hasSpouse: profile?.spouse != null,
    spouse: profile?.spouse ?? { ...BLANK_PERSON },
    filingStatus: profile?.filingStatus ?? 'married_filing_jointly',
    stateAbbreviation: profile?.stateOfResidence ?? '',
    hasStateIncomeTax: profile?.hasStateIncomeTax ?? true,
    currentYear: profile?.currentYear ?? new Date().getFullYear(),
    retirementYearDesired: profile?.retirementYearDesired ?? new Date().getFullYear() + 5,
    accounts: accounts.length > 0 ? accounts : [{ id: '1', label: '', owner: 'client', type: 'pretax_ira', currentBalance: 0 }],
    homeEquity,
    essentialAnnualSpending: spending?.baseAnnualSpending ?? 0,
    lifestyleSpendingActive: spending?.travelBudgetEarly ?? 0,
    lifestyleSpendingSlower: spending?.travelBudgetLate ?? 0,
    lifestyleTaperAge: spending?.travelTaperStartAge ?? 75,
    charitableGivingAnnual: spending?.charitableGivingAnnual ?? 0,
    oneTimeExpenses: spending?.oneTimeExpenses ?? [],
    inflationRate: spending?.inflationRate ?? 0.03,
    mortgageAnnualPayment: spending?.mortgageAnnualPayment ?? 0,
    mortgagePaidOffAge: spending?.mortgagePaidOffAge ?? 69,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { setProfile, setAssets, setSpending, profile, assets, spending } = useProfileStore();
  const { runSimulations, markStale } = useSimulationStore();
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() =>
    buildFormState(profile, assets?.accounts ?? [], assets?.homeEquity ?? 0, spending)
  );

  useEffect(() => {
    if (!profile && !assets && !spending) {
      setForm(buildFormState(null, [], 0, null));
    }
  }, [profile, assets, spending]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateClient(patch: Partial<PersonProfile>) {
    setForm((f) => ({ ...f, client: { ...f.client, ...patch } }));
  }

  function updateSpouse(patch: Partial<PersonProfile>) {
    setForm((f) => ({ ...f, spouse: { ...f.spouse, ...patch } }));
  }

  function updateAccount(id: string, patch: Partial<Account>) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  function addAccount() {
    const id = String(Date.now());
    setForm((f) => ({
      ...f,
      accounts: [...f.accounts, { id, label: '', owner: 'client', type: 'pretax_ira', currentBalance: 0 }],
    }));
  }

  function removeAccount(id: string) {
    setForm((f) => ({ ...f, accounts: f.accounts.filter((a) => a.id !== id) }));
  }

  function addLumpyExpense() {
    const newExpense: OneTimeExpense = {
      year: form.retirementYearDesired + 2,
      label: '',
      amount: 0,
    };
    setForm((f) => ({ ...f, oneTimeExpenses: [...f.oneTimeExpenses, newExpense] }));
  }

  function updateLumpyExpense(index: number, patch: Partial<OneTimeExpense>) {
    setForm((f) => {
      const updated = [...f.oneTimeExpenses];
      updated[index] = { ...updated[index], ...patch };
      return { ...f, oneTimeExpenses: updated };
    });
  }

  function removeLumpyExpense(index: number) {
    setForm((f) => ({
      ...f,
      oneTimeExpenses: f.oneTimeExpenses.filter((_, i) => i !== index),
    }));
  }

  function handleStateChange(abbreviation: string) {
    const info = getStateInfo(abbreviation);
    setForm((f) => ({
      ...f,
      stateAbbreviation: abbreviation,
      hasStateIncomeTax: info ? info.hasIncomeTax : true,
    }));
  }

  function loadDemo() {
    setForm(buildFormState(DEMO_PROFILE, DEMO_ACCOUNTS, 600_000, DEMO_SPENDING));
  }

  function handleSubmit() {
    const clientProfile: ClientProfile = {
      client: form.client,
      spouse: form.hasSpouse ? form.spouse : null,
      filingStatus: form.filingStatus,
      stateOfResidence: form.stateAbbreviation,
      hasStateIncomeTax: form.hasStateIncomeTax,
      currentYear: form.currentYear,
      retirementYearDesired: form.retirementYearDesired,
      cobraMonths: 18, // standard federal COBRA period; not user-configurable
    };

    const spendingProfile: SpendingProfile = {
      baseAnnualSpending: form.essentialAnnualSpending,
      travelBudgetEarly: form.lifestyleSpendingActive,
      travelBudgetLate: form.lifestyleSpendingSlower,
      travelTaperStartAge: form.lifestyleTaperAge,
      charitableGivingAnnual: form.charitableGivingAnnual,
      oneTimeExpenses: form.oneTimeExpenses,
      inflationRate: form.inflationRate,
      ...(form.mortgageAnnualPayment > 0 && {
        mortgageAnnualPayment: form.mortgageAnnualPayment,
        mortgagePaidOffAge: form.mortgagePaidOffAge,
      }),
    };

    setProfile(clientProfile);
    setAssets(deriveAssetTotals(form.accounts, form.homeEquity));
    setSpending(spendingProfile);
    markStale();
    runSimulations();
    router.push('/scenarios');
  }

  const totalLiquid = form.accounts.reduce((s, a) => s + (a.currentBalance || 0), 0);
  const totalEarlySpend = form.essentialAnnualSpending + form.lifestyleSpendingActive + form.charitableGivingAnnual + form.mortgageAnnualPayment;
  const totalLaterSpend = form.essentialAnnualSpending + form.lifestyleSpendingSlower + form.charitableGivingAnnual;
  const selectedStateInfo = getStateInfo(form.stateAbbreviation);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Profile &amp; Assets</h1>
        <button
          onClick={loadDemo}
          className="px-3 py-1.5 text-xs border border-yellow-700 text-yellow-400 hover:bg-yellow-950 rounded transition-colors"
        >
          Load Demo (Mike &amp; Laura)
        </button>
      </div>

      <div className="space-y-6">

        {/* ── You ── */}
        <Section title="You">
          <PersonFields person={form.client} onChange={updateClient} />
        </Section>

        {/* ── Spouse toggle ── */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.hasSpouse}
            onChange={(e) => {
              setForm((f) => ({
                ...f,
                hasSpouse: e.target.checked,
                filingStatus: e.target.checked ? 'married_filing_jointly' : 'single',
              }));
            }}
            className="w-4 h-4 accent-blue-500"
          />
          <span className="text-sm text-gray-300">Include spouse / partner</span>
        </label>

        {form.hasSpouse && (
          <Section title="Spouse / Partner">
            <PersonFields person={form.spouse} onChange={updateSpouse} />
          </Section>
        )}

        {/* ── Plan Details ── */}
        <Section title="Plan Details">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4">
            <Field label="State of Residence">
              <select
                value={form.stateAbbreviation}
                onChange={(e) => handleStateChange(e.target.value)}
                className={selectClass}
              >
                <option value="">Select state…</option>
                {US_STATES.map((s) => (
                  <option key={s.abbreviation} value={s.abbreviation}>
                    {s.name}
                  </option>
                ))}
              </select>
              {selectedStateInfo && (
                <p className="text-xs mt-1 text-gray-500">
                  {selectedStateInfo.hasIncomeTax
                    ? `State income tax: up to ${(selectedStateInfo.topMarginalRate * 100).toFixed(1)}%`
                    : 'No state income tax'}
                </p>
              )}
            </Field>

            <Field label="Filing Status">
              <select
                value={form.filingStatus}
                onChange={(e) => set('filingStatus', e.target.value as FormState['filingStatus'])}
                className={selectClass}
              >
                <option value="married_filing_jointly">Married Filing Jointly</option>
                <option value="single">Single</option>
              </select>
            </Field>

            <Field label="Current Year">
              <NumericInput
                value={form.currentYear}
                onChange={(v) => set('currentYear', v)}
                className={inputClass}
              />
            </Field>

            <Field label="Target Retirement Year">
              <NumericInput
                value={form.retirementYearDesired}
                onChange={(v) => set('retirementYearDesired', v)}
                className={inputClass}
              />
            </Field>
          </div>
        </Section>

        {/* ── Assets ── */}
        <Section title="Accounts & Assets">
          <div className="px-4 py-4 space-y-3">
            <div className="grid grid-cols-[1fr_90px_120px_130px_130px_28px] gap-2 text-xs text-gray-500 px-1 mb-1">
              <span>Account name</span>
              <span>Owner</span>
              <span>Type</span>
              <span>Balance</span>
              <span>Cost Basis</span>
              <span />
            </div>

            {form.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                hasSpouse={form.hasSpouse}
                onChange={(patch) => updateAccount(account.id, patch)}
                onRemove={() => removeAccount(account.id)}
              />
            ))}

            <button
              type="button"
              onClick={addAccount}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors mt-1"
            >
              + Add account
            </button>

            <div className="border-t border-gray-700 pt-3 mt-2">
              <Field label="Home Equity (non-liquid — for reference only)">
                <CurrencyInput value={form.homeEquity} onChange={(v) => set('homeEquity', v)} />
              </Field>
            </div>

            <div className="flex justify-between text-sm pt-1 border-t border-gray-700">
              <span className="text-gray-400">Total Liquid Assets</span>
              <span className="text-white font-semibold">{formatCurrency(totalLiquid)}</span>
            </div>
          </div>
        </Section>

        {/* ── Spending ── */}
        <Section title="Annual Spending">
          <div className="px-4 py-4 space-y-5">

            {/* Essential */}
            <div>
              <Field label="Essential Expenses (annual)">
                <CurrencyInput
                  value={form.essentialAnnualSpending}
                  onChange={(v) => set('essentialAnnualSpending', v)}
                />
              </Field>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Fixed costs that don't change with your activity level: property taxes, homeowners/auto insurance, utilities, groceries, base transportation, Medicare premiums, regular prescriptions.
              </p>
            </div>

            {/* Lifestyle */}
            <div>
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">Lifestyle Spending</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Active years (early retirement)">
                  <CurrencyInput
                    value={form.lifestyleSpendingActive}
                    onChange={(v) => set('lifestyleSpendingActive', v)}
                  />
                </Field>
                <Field label="Slower years (later retirement)">
                  <CurrencyInput
                    value={form.lifestyleSpendingSlower}
                    onChange={(v) => set('lifestyleSpendingSlower', v)}
                  />
                </Field>
                <Field label={`Spending steps down at age (yours)`}>
                  <NumericInput
                    value={form.lifestyleTaperAge}
                    onChange={(v) => set('lifestyleTaperAge', v)}
                    min={60}
                    max={90}
                    className={inputClass}
                  />
                </Field>
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Discretionary spending that naturally decreases as activity slows: travel, dining out, hobbies, entertainment, subscriptions, clothing. Most people spend 20–40% less in their 70s+ than in their 60s.
              </p>
            </div>

            {/* Charitable */}
            <Field label="Charitable Giving (annual)">
              <CurrencyInput
                value={form.charitableGivingAnnual}
                onChange={(v) => set('charitableGivingAnnual', v)}
              />
            </Field>

            {/* Mortgage */}
            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Mortgage at Retirement (optional)</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Annual P&I Payment">
                  <CurrencyInput
                    value={form.mortgageAnnualPayment}
                    onChange={(v) => set('mortgageAnnualPayment', v)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Paid Off at Client Age">
                  <NumericInput
                    value={form.mortgagePaidOffAge}
                    onChange={(v) => set('mortgagePaidOffAge', v)}
                    min={50}
                    max={100}
                    className={inputClass}
                  />
                </Field>
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Fixed-rate mortgage P&I only (not escrow/insurance). The payment stays constant in nominal dollars — it does NOT inflate. Leave at $0 if you will be mortgage-free at retirement.
              </p>
            </div>

            {/* Totals */}
            <div className="bg-gray-800 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">Early retirement total (incl. mortgage)</span>
                <span className="text-white font-medium">{formatCurrency(totalEarlySpend)}/yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Later retirement total (post-mortgage)</span>
                <span className="text-white font-medium">{formatCurrency(totalLaterSpend)}/yr</span>
              </div>
            </div>

            {/* Lumpy expenses */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Lumpy / One-Time Expenses</p>
                <button
                  type="button"
                  onClick={addLumpyExpense}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add
                </button>
              </div>

              {form.oneTimeExpenses.length === 0 ? (
                <p className="text-xs text-gray-600 italic">No lumpy expenses added yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[80px_1fr_130px_28px] gap-2 text-xs text-gray-500 px-1">
                    <span>Year</span><span>Description</span><span>Amount</span><span />
                  </div>
                  {form.oneTimeExpenses.map((exp, i) => (
                    <div key={i} className="grid grid-cols-[80px_1fr_130px_28px] gap-2 items-center">
                      <NumericInput
                        value={exp.year}
                        onChange={(v) => updateLumpyExpense(i, { year: v })}
                        className={inputClass + ' text-sm'}
                      />
                      <input
                        type="text"
                        value={exp.label}
                        onChange={(e) => updateLumpyExpense(i, { label: e.target.value })}
                        placeholder="e.g. Roof replacement"
                        className={inputClass + ' text-sm'}
                      />
                      <CurrencyInput
                        value={exp.amount}
                        onChange={(v) => updateLumpyExpense(i, { amount: v })}
                      />
                      <button
                        type="button"
                        onClick={() => removeLumpyExpense(i)}
                        className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 transition-colors">
                  Common pitfalls people forget to plan for
                </summary>
                <ul className="mt-2 text-xs text-gray-500 space-y-1 pl-3 list-disc leading-relaxed">
                  <li>Home maintenance — typically 1–2% of home value per year (roof, HVAC, plumbing, appliances)</li>
                  <li>Vehicle replacement — every 8–12 years</li>
                  <li>Dental, hearing aids, vision — largely not covered by Medicare</li>
                  <li>Adult children — weddings, down payment help, college for late kids</li>
                  <li>Long-term care — home care or assisted living</li>
                  <li>Family emergencies — medical bills, helping a parent</li>
                  <li>Employer benefits that disappear — life insurance, disability, HSA contributions</li>
                </ul>
              </details>
            </div>

            {/* Inflation */}
            <Field label="Assumed Inflation Rate">
              <div className="relative w-32">
                <NumericInput
                  value={parseFloat((form.inflationRate * 100).toFixed(1))}
                  onChange={(v) => set('inflationRate', v / 100)}
                  min={1}
                  max={10}
                  className={inputClass + ' pr-7'}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">%</span>
              </div>
            </Field>
          </div>
        </Section>

        {/* ── Submit ── */}
        <button
          onClick={handleSubmit}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
        >
          Save &amp; Run Simulation →
        </button>
      </div>
    </div>
  );
}

// ─── PersonFields ─────────────────────────────────────────────────────────────

function PersonFields({
  person,
  onChange,
}: {
  person: PersonProfile;
  onChange: (patch: Partial<PersonProfile>) => void;
}) {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Name">
          <input
            type="text"
            value={person.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="First name"
            className={inputClass}
          />
        </Field>

        <Field label="Current Age">
          <NumericInput
            value={person.age}
            onChange={(v) => onChange({ age: v, birthYear: new Date().getFullYear() - v })}
            min={25}
            max={90}
            className={inputClass}
          />
        </Field>

        <Field label="Life Expectancy">
          <NumericInput
            value={person.lifeExpectancy}
            onChange={(v) => onChange({ lifeExpectancy: v })}
            min={70}
            max={110}
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1">
            Use 90 for men, 95 for women as a conservative default.{' '}
            <span className="text-gray-600">SSA.gov has a calculator if you want to be precise.</span>
          </p>
        </Field>

        <Field label="Full Retirement Age (for SS)">
          <NumericInput
            value={person.fullRetirementAge}
            onChange={(v) => onChange({ fullRetirementAge: v })}
            min={62}
            max={70}
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1">Born 1960+: FRA is 67.</p>
        </Field>

        <Field label="SS Benefit at FRA ($/month)">
          <CurrencyInput
            value={person.fraMonthlyBenefit}
            onChange={(v) => onChange({ fraMonthlyBenefit: v })}
          />
          <p className="text-xs text-gray-500 mt-1">
            Your estimated monthly benefit if you claim exactly at your Full Retirement Age.{' '}
            <span className="text-gray-600">Find this on your Social Security statement at ssa.gov/myaccount.</span>
          </p>
        </Field>

        <Field label="Planned SS Claim Age">
          <NumericInput
            value={person.socialSecurityClaimAge}
            onChange={(v) => onChange({ socialSecurityClaimAge: v })}
            min={62}
            max={70}
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1">62–70. Later = higher monthly benefit.</p>
        </Field>
      </div>
    </div>
  );
}

// ─── AccountRow ───────────────────────────────────────────────────────────────

function AccountRow({
  account,
  hasSpouse,
  onChange,
  onRemove,
}: {
  account: Account;
  hasSpouse: boolean;
  onChange: (patch: Partial<Account>) => void;
  onRemove: () => void;
}) {
  const showCostBasis = account.type === 'brokerage';

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_90px_120px_130px_130px_28px] gap-2 items-center">
        <input
          type="text"
          value={account.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="e.g. My Rollover IRA"
          className={inputClass + ' text-sm'}
        />

        <select
          value={account.owner}
          onChange={(e) => onChange({ owner: e.target.value as Account['owner'] })}
          className={selectClass + ' text-sm'}
        >
          <option value="client">Me</option>
          {hasSpouse && <option value="spouse">Spouse</option>}
          <option value="joint">Joint</option>
        </select>

        <select
          value={account.type}
          onChange={(e) =>
            onChange({
              type: e.target.value as Account['type'],
              isInherited: e.target.value === 'inherited_ira',
            })
          }
          className={selectClass + ' text-sm'}
        >
          <option value="pretax_ira">Pre-tax IRA / 401k</option>
          <option value="roth_ira">Roth IRA</option>
          <option value="brokerage">Brokerage</option>
          <option value="inherited_ira">Inherited IRA</option>
        </select>

        <CurrencyInput value={account.currentBalance} onChange={(v) => onChange({ currentBalance: v })} />

        {showCostBasis ? (
          <CurrencyInput
            value={account.costBasis ?? 0}
            onChange={(v) => onChange({ costBasis: v })}
            placeholder="Cost basis"
          />
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={onRemove}
          className="text-gray-600 hover:text-red-400 transition-colors text-xl leading-none"
        >
          ×
        </button>
      </div>

      {account.type === 'inherited_ira' && (
        <div className="pl-1 flex items-center gap-2 text-xs text-gray-500">
          <span>Years remaining in 10-year distribution rule:</span>
          <NumericInput
            value={account.inheritedIraRemainingYears ?? 10}
            onChange={(v) => onChange({ inheritedIraRemainingYears: v })}
            min={1}
            max={10}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
          />
        </div>
      )}
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
        <h2 className="font-semibold text-white text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

// Numeric input that stores raw string internally — avoids leading-zero and
// cursor-position problems with controlled <input type="number">.
function NumericInput({
  value,
  onChange,
  min,
  max,
  className = '',
  placeholder = '',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(() => (value === 0 ? '' : String(value)));
  const prevValue = useRef(value);

  // Sync when parent value changes externally (e.g. Load Demo)
  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setRaw(value === 0 ? '' : String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      placeholder={placeholder}
      onChange={(e) => {
        const str = e.target.value.replace(/[^0-9.]/g, '');
        setRaw(str);
        const num = parseFloat(str);
        if (!isNaN(num)) {
          prevValue.current = num;
          onChange(num);
        }
      }}
      onBlur={() => {
        const num = parseFloat(raw);
        if (isNaN(num)) {
          setRaw('');
          onChange(0);
        } else {
          const clamped =
            min !== undefined || max !== undefined
              ? Math.max(min ?? num, Math.min(max ?? num, num))
              : num;
          prevValue.current = clamped;
          setRaw(String(clamped));
          onChange(clamped);
        }
      }}
      className={className}
    />
  );
}

function CurrencyInput({
  value,
  onChange,
  placeholder = '0',
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(() => (value === 0 ? '' : String(value)));
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setRaw(value === 0 ? '' : String(value));
    }
  }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none select-none">
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        placeholder={placeholder}
        onChange={(e) => {
          const str = e.target.value.replace(/[^0-9.]/g, '');
          setRaw(str);
          const num = parseFloat(str);
          if (!isNaN(num)) {
            prevValue.current = num;
            onChange(num);
          } else if (str === '') {
            onChange(0);
          }
        }}
        onBlur={() => {
          const num = parseFloat(raw);
          if (isNaN(num)) {
            setRaw('');
            onChange(0);
          } else {
            prevValue.current = num;
            setRaw(String(num));
            onChange(num);
          }
        }}
        className={inputClass + ' pl-6'}
      />
    </div>
  );
}

const inputClass =
  'w-full h-9 bg-gray-800 border border-gray-700 rounded px-2.5 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors';

const selectClass =
  'w-full h-9 bg-gray-800 border border-gray-700 rounded px-2 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors';
