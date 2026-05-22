'use client';

import { useState, useEffect } from 'react';
import { useProfileStore } from '@/store/profile.store';
import { useSimulationStore } from '@/store/simulation.store';
import { deriveAssetTotals } from '@/domain/types/assets';
import type { ClientProfile } from '@/domain/types/profile';
import type { OneTimeExpense, SpendingProfile } from '@/domain/types/spending';
import { formatCurrency } from '@/lib/format';
import { US_STATES, getStateInfo } from '@/domain/constants/states';
import { useRouter } from 'next/navigation';

import { DEMOS } from './_demos';
import { type FormState, buildFormState } from './_form-state';
import {
  AccountRow,
  CurrencyInput,
  Field,
  NumericInput,
  PersonFields,
  Section,
  inputClass,
  selectClass,
} from './_components';

const FIREWHERE_BASE = 'https://www.pablooverton.com/firewhere/';

function growthScenarioToRealReturn(g: FormState['growthScenario']): number {
  switch (g) {
    case 'pessimistic':  return 0.03;
    case 'conservative': return 0.04;
    case 'moderate':     return 0.05;
    case 'optimistic':   return 0.06;
    case 'historical':   return 0.07;
  }
}

function buildFirewhereURL(form: FormState): string {
  const totalSavings = form.accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
  const annualSavings =
    form.annualContributions.pretax +
    form.annualContributions.roth +
    form.annualContributions.brokerage +
    form.annualContributions.hsa;
  const params = new URLSearchParams({
    source: 'lumpslam',
    currentAge: String(form.client.age),
    currentSavings: String(totalSavings),
    annualSavings: String(annualSavings),
    currentSpending: String(form.essentialAnnualSpending),
    realReturn: String(growthScenarioToRealReturn(form.growthScenario)),
  });
  return `${FIREWHERE_BASE}?${params.toString()}`;
}

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

  const [prefilledFromFirewhere, setPrefilledFromFirewhere] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') !== 'firewhere') return;

    const num = (k: string) => {
      const v = Number(params.get(k));
      return Number.isFinite(v) ? v : null;
    };

    const currentAge = num('currentAge');
    const currentSavings = num('currentSavings');
    const annualSavings = num('annualSavings');
    const currentSpending = num('currentSpending');
    const realReturn = num('realReturn');

    setForm((f) => ({
      ...f,
      client:
        currentAge != null && currentAge > 0
          ? { ...f.client, age: currentAge, birthYear: f.currentYear - currentAge }
          : f.client,
      accounts: f.accounts.map((a, i) =>
        i === 0 && currentSavings != null && currentSavings > 0
          ? { ...a, currentBalance: currentSavings, label: a.label || 'Brokerage' }
          : a
      ),
      annualContributions: {
        ...f.annualContributions,
        brokerage:
          annualSavings != null && annualSavings >= 0
            ? annualSavings
            : f.annualContributions.brokerage,
      },
      essentialAnnualSpending:
        currentSpending != null && currentSpending > 0
          ? currentSpending
          : f.essentialAnnualSpending,
      growthScenario: (() => {
        if (realReturn == null || realReturn <= 0) return f.growthScenario;
        if (realReturn <= 0.035) return 'pessimistic';
        if (realReturn <= 0.045) return 'conservative';
        if (realReturn <= 0.055) return 'moderate';
        if (realReturn <= 0.065) return 'optimistic';
        return 'historical';
      })(),
    }));
    setPrefilledFromFirewhere(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const updateClient = (patch: Partial<FormState['client']>) =>
    setForm((f) => ({ ...f, client: { ...f.client, ...patch } }));

  const updateSpouse = (patch: Partial<FormState['spouse']>) =>
    setForm((f) => ({ ...f, spouse: { ...f.spouse, ...patch } }));

  const updateAccount = (id: string, patch: Partial<FormState['accounts'][number]>) =>
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));

  const addAccount = () =>
    setForm((f) => ({
      ...f,
      accounts: [
        ...f.accounts,
        { id: String(Date.now()), label: '', owner: 'client', type: 'pretax_ira', currentBalance: 0 },
      ],
    }));

  const removeAccount = (id: string) =>
    setForm((f) => ({ ...f, accounts: f.accounts.filter((a) => a.id !== id) }));

  const addLumpyExpense = () => {
    const newExpense: OneTimeExpense = {
      year: form.retirementYearDesired + 2,
      label: '',
      amount: 0,
    };
    setForm((f) => ({ ...f, oneTimeExpenses: [...f.oneTimeExpenses, newExpense] }));
  };

  const updateLumpyExpense = (index: number, patch: Partial<OneTimeExpense>) =>
    setForm((f) => {
      const updated = [...f.oneTimeExpenses];
      updated[index] = { ...updated[index], ...patch };
      return { ...f, oneTimeExpenses: updated };
    });

  const removeLumpyExpense = (index: number) =>
    setForm((f) => ({
      ...f,
      oneTimeExpenses: f.oneTimeExpenses.filter((_, i) => i !== index),
    }));

  function handleStateChange(abbreviation: string) {
    const info = getStateInfo(abbreviation);
    setForm((f) => ({
      ...f,
      stateAbbreviation: abbreviation,
      hasStateIncomeTax: info ? info.hasIncomeTax : true,
    }));
  }

  const [selectedDemo, setSelectedDemo] = useState('');

  function loadDemo(key: string) {
    const demo = DEMOS.find((d) => d.key === key);
    if (!demo) return;
    setSelectedDemo(key);
    setForm(buildFormState(demo.profile, demo.accounts, demo.homeEquity, demo.spending));
  }

  function handleSubmit() {
    const retirementLocation: 'us' | 'international' = form.retireOutsideUS ? 'international' : 'us';
    const isSelfInsure = !form.retireOutsideUS && form.healthBridge === 'self_insure';
    const cobraMonths = form.retireOutsideUS || isSelfInsure
      ? 0
      : form.healthBridge === 'cobra' ? 18 : 0;
    const acaHouseholdSize = 1 + (form.hasSpouse ? 1 : 0) + form.dependentsOnPlan;
    const annualGrowthRate =
      form.growthScenario === 'pessimistic'  ? 0.03
      : form.growthScenario === 'conservative' ? 0.04
      : form.growthScenario === 'optimistic'   ? 0.06
      : form.growthScenario === 'historical'   ? 0.07
      : 0.05; // moderate (default — 60/40 real)

    const totalContribs =
      form.annualContributions.pretax +
      form.annualContributions.roth +
      form.annualContributions.brokerage +
      form.annualContributions.hsa;

    const clientProfile: ClientProfile = {
      client: form.client,
      spouse: form.hasSpouse ? form.spouse : null,
      filingStatus: form.filingStatus,
      stateOfResidence: form.stateAbbreviation,
      hasStateIncomeTax: form.hasStateIncomeTax,
      currentYear: form.currentYear,
      retirementYearDesired: form.retirementYearDesired,
      cobraMonths,
      acaHouseholdSize,
      annualGrowthRate,
      retirementLocation,
      ...(isSelfInsure && { healthcareCoverage: 'self_insure' as const }),
      targetBracket: form.targetBracket,
      annualContributions: totalContribs > 0 ? form.annualContributions : undefined,
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
      ...(form.annualHealthcareCost > 0 && {
        annualHealthcareCost: form.annualHealthcareCost,
      }),
      ...(isSelfInsure && {
        selfInsuranceAnnualBudget: form.selfInsuranceAnnualBudget,
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
  const totalEarlySpend =
    form.essentialAnnualSpending +
    form.annualHealthcareCost +
    form.lifestyleSpendingActive +
    form.charitableGivingAnnual +
    form.mortgageAnnualPayment;
  const totalLaterSpend =
    form.essentialAnnualSpending +
    form.annualHealthcareCost +
    form.lifestyleSpendingSlower +
    form.charitableGivingAnnual;
  const selectedStateInfo = getStateInfo(form.stateAbbreviation);
  const totalContribs =
    form.annualContributions.pretax +
    form.annualContributions.roth +
    form.annualContributions.brokerage +
    form.annualContributions.hsa;
  const workingYears = form.retirementYearDesired - form.currentYear;
  const selectedDemoEntry = DEMOS.find((d) => d.key === selectedDemo);

  // Resolved real growth rate from the scenario picker (mirrors the mapping in handleSubmit).
  const realGrowthRate =
    form.growthScenario === 'pessimistic'  ? 0.03
    : form.growthScenario === 'conservative' ? 0.04
    : form.growthScenario === 'optimistic'   ? 0.06
    : form.growthScenario === 'historical'   ? 0.07
    : 0.05;
  const realReturnPct = (realGrowthRate * 100).toFixed(1);

  return (
    <div className="max-w-3xl">
      {prefilledFromFirewhere && (
        <div className="mb-4 p-3 rounded-lg border border-blue-900 bg-blue-950/30 text-sm text-blue-100">
          <strong className="text-blue-200">Inputs pre-filled from firewhere.</strong> Adjust as
          needed for full retirement modeling, then run scenarios.{' '}
          <a
            href="https://www.pablooverton.com/firewhere/"
            className="underline hover:text-blue-200"
          >
            ← back to firewhere
          </a>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">Profile &amp; Assets</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Try a demo:</span>
          <select
            value={selectedDemo}
            onChange={(e) => loadDemo(e.target.value)}
            className="text-xs bg-gray-800 border border-yellow-700 text-yellow-400 rounded px-2 py-1.5 cursor-pointer focus:outline-none focus:border-yellow-500"
          >
            <option value="">— pick a scenario —</option>
            {DEMOS.map((d) => (
              <option key={d.key} value={d.key}>{d.label} — {d.tag}</option>
            ))}
          </select>
        </div>
      </div>
      {selectedDemoEntry && (
        <p className="text-xs text-gray-500 mb-5 leading-relaxed border-l-2 border-yellow-800 pl-3">
          {selectedDemoEntry.situation}
        </p>
      )}

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

        {/* ── Coverage & Healthcare Bridge ── */}
        <Section title="Coverage &amp; Healthcare Bridge">
          <div className="px-4 py-4 space-y-5">

            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Where will you retire?</p>
              <div className="flex gap-3">
                {([
                  { value: false, label: 'In the US' },
                  { value: true,  label: 'Outside the US' },
                ] as const).map(({ value, label }) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => set('retireOutsideUS', value)}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      form.retireOutsideUS === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.retireOutsideUS && (
                <div className="mt-2 space-y-1.5 text-xs leading-relaxed">
                  <p className="text-gray-400">
                    <span className="text-green-400 font-medium">What changes:</span> No ACA. Pre-Medicare years have no income cliff — Roth conversions can run freely. Include international health insurance in Essential Expenses.
                  </p>
                  <p className="text-gray-500">
                    <span className="text-yellow-600 font-medium">What this tool doesn&apos;t model:</span> Foreign tax credits (taxes paid abroad can offset your US bill — actual liability may be lower), and state taxes (if you formally change domicile, you may owe nothing to your prior state). Tax treaty details are country-specific and beyond scope here — consult a cross-border tax advisor for those.
                  </p>
                  <div className="pt-1">
                    <a
                      href={buildFirewhereURL(form)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue-700 bg-blue-950/40 text-blue-200 text-xs font-medium hover:border-blue-500 hover:bg-blue-950/60 transition-colors"
                    >
                      Compare 57 countries in firewhere <span aria-hidden="true">↗</span>
                    </a>
                    <p className="mt-1.5 text-gray-500 text-[11px]">
                      firewhere ranks countries by FIRE breakeven with localized cost-of-living, healthcare, and tax (progressive brackets for 10 top destinations). Inputs from this page will be pre-filled.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {!form.retireOutsideUS && (
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">How will you get health coverage before Medicare?</p>
                <div className="flex flex-col gap-2">
                  {([
                    { value: 'cobra',           label: 'COBRA — 18 months',         desc: 'Continue your employer\'s plan. You pay the full premium for up to 18 months, then move to ACA.' },
                    { value: 'aca',             label: 'ACA Marketplace',            desc: 'Enroll directly in a marketplace plan at retirement. Subsidies available if income stays below the eligibility threshold.' },
                    { value: 'spouse_employer', label: 'Spouse\'s employer',         desc: 'Covered under your spouse\'s employer plan until Medicare. No ACA enrollment needed.' },
                    { value: 'self_insure',     label: 'Self-insure (no traditional plan)', desc: 'No ACA, no COBRA. Cover health costs out-of-pocket, with a health-share program (CrowdHealth, Samaritan), or through medical tourism for planned procedures. No MAGI cliff to manage; conversions can run freely. Real out-of-pocket risk.' },
                  ] as const).map(({ value, label, desc }) => (
                    <label
                      key={value}
                      className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                        form.healthBridge === value
                          ? 'border-blue-600 bg-blue-950'
                          : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="healthBridge"
                        checked={form.healthBridge === value}
                        onChange={() => set('healthBridge', value)}
                        className="mt-0.5 accent-blue-500 shrink-0"
                      />
                      <div>
                        <p className="text-sm text-white font-medium">{label}</p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {form.healthBridge === 'self_insure' && (
                  <div className="mt-3 px-3 py-3 rounded border border-blue-900 bg-blue-950/40">
                    <Field label="Anticipated annual healthcare budget (pre-Medicare)">
                      <div className="relative w-40">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                        <NumericInput
                          value={form.selfInsuranceAnnualBudget}
                          onChange={(v) => set('selfInsuranceAnnualBudget', v)}
                          min={0}
                          className={inputClass + ' pl-6'}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                        Real (today’s) dollars; inflates yearly. Sizing examples: <span className="text-gray-300">$0–3k</span> direct primary care + cash routine, <span className="text-gray-300">$5–8k</span> health-share membership (Samaritan, Medi-Share), <span className="text-gray-300">$15–25k</span> CrowdHealth-style catastrophic-mimicking program with per-event/year cap. Add a separate budget for medical-tourism procedures (often 10× cheaper than US sticker price). Medicare still kicks in at 65 — opting out carries lifetime late-enrollment penalties.
                      </p>
                    </Field>
                  </div>
                )}
              </div>
            )}

            {!form.retireOutsideUS && form.healthBridge !== 'spouse_employer' && form.healthBridge !== 'self_insure' && (
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1.5">
                  Children or other dependents on your health plan in early retirement?
                </p>
                <div className="flex gap-2">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set('dependentsOnPlan', n)}
                      className={`w-10 h-9 rounded text-sm font-medium transition-colors ${
                        form.dependentsOnPlan === n
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {n === 4 ? '4+' : n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                  Children under 26 can stay on your plan.{form.hasSpouse ? ' Your spouse is already counted.' : ''}{' '}
                  This determines your ACA subsidy eligibility threshold.
                </p>
              </div>
            )}

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

            <div>
              <Field label="Essential Expenses (annual)">
                <CurrencyInput
                  value={form.essentialAnnualSpending}
                  onChange={(v) => set('essentialAnnualSpending', v)}
                />
              </Field>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Fixed costs that don&apos;t change with your activity level: property taxes, homeowners/auto insurance, utilities, groceries, base transportation, Medicare premiums, regular prescriptions.
                {form.annualHealthcareCost > 0 && (
                  <span className="text-yellow-600"> Do not include healthcare costs here — they are entered separately below and drawn from HSA first.</span>
                )}
              </p>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Healthcare Cost (HSA Routing — optional)</p>
              <Field label="Annual Healthcare Cost">
                <CurrencyInput
                  value={form.annualHealthcareCost}
                  onChange={(v) => set('annualHealthcareCost', v)}
                  placeholder="0"
                />
              </Field>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                If you have an HSA account, enter your annual healthcare cost here (ACA premiums, Medicare Part B/D, Medigap). This amount will be drawn from your HSA balance first each year. If HSA is exhausted, the remainder is added to spending. Leave at $0 to include healthcare in Essential Expenses instead.
              </p>
            </div>

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
                <Field label="Spending steps down at age (yours)">
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

            <Field label="Charitable Giving (annual)">
              <CurrencyInput
                value={form.charitableGivingAnnual}
                onChange={(v) => set('charitableGivingAnnual', v)}
              />
            </Field>

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

        {/* ── Advanced ── */}
        <details className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
          <summary className="px-4 py-3 bg-gray-800 text-sm font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors list-none flex items-center justify-between select-none">
            <span>Advanced Settings</span>
            <span className="text-xs font-normal">Market scenario, growth rate</span>
          </summary>
          <div className="px-4 py-4 space-y-4">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Market Scenario</p>
              <div className="flex gap-2">
                {([
                  { value: 'pessimistic',  label: 'Pessimistic',  real: '3%', context: 'Bond-heavy / stress test' },
                  { value: 'conservative', label: 'Conservative', real: '4%', context: '40/60 blended' },
                  { value: 'moderate',     label: 'Moderate',     real: '5%', context: '60/40 Boglehead baseline' },
                  { value: 'optimistic',   label: 'Optimistic',   real: '6%', context: '70/30 equity tilt' },
                  { value: 'historical',   label: 'Historical',   real: '7%', context: 'US equity long-run avg' },
                ] as const).map(({ value, label, real, context }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('growthScenario', value)}
                    title={context}
                    className={`flex-1 px-2 py-2.5 rounded border text-xs font-medium transition-colors text-center ${
                      form.growthScenario === value
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <div className="font-semibold">{real}</div>
                    <div className="opacity-70 mt-0.5">{label}</div>
                    <div className="opacity-50 mt-0.5 text-[10px]">real</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Real annual return (above inflation). Moderate (5% real) ≈ 8% nominal at 3% inflation — the Boglehead 60/40 baseline. Historical US equities ≈ 7% real (1926–2023). The engine simulates entirely in today&rsquo;s dollars; pick the real return your allocation will earn.
              </p>
              <div className="mt-3 px-3 py-2 rounded text-xs leading-relaxed border border-gray-700 bg-gray-800 text-gray-300">
                <p>
                  <span className="font-medium">Real return used:</span>{' '}
                  <span className="font-mono">{realReturnPct}%</span>{' '}
                  <span className="opacity-70">
                    (today&rsquo;s-dollar growth — inflation already removed)
                  </span>
                </p>
              </div>
            </div>

            {workingYears > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Annual Contributions (Working Years)</p>
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                  How much you add each year until retirement. Each dollar is compounded at the growth rate above across {workingYears} working {workingYears === 1 ? 'year' : 'years'} — leaving these at $0 significantly understates your retirement portfolio.
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {([
                    { key: 'pretax',    label: 'Pre-tax 401k / IRA (total household)' },
                    { key: 'roth',      label: 'Roth IRA — incl. backdoor (total household)' },
                    { key: 'brokerage', label: 'Taxable brokerage savings' },
                    { key: 'hsa',       label: 'HSA contributions (total household)' },
                  ] as const).map(({ key, label }) => (
                    <Field key={key} label={label}>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                        <NumericInput
                          value={form.annualContributions[key]}
                          onChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              annualContributions: { ...f.annualContributions, [key]: v },
                            }))
                          }
                          className={inputClass + ' pl-6'}
                        />
                      </div>
                    </Field>
                  ))}
                </div>
                {totalContribs > 0 && (
                  <p className="text-xs text-gray-500 mt-2">
                    ${(totalContribs / 1_000).toFixed(1)}k/yr saved over {workingYears} years
                  </p>
                )}
              </div>
            )}
          </div>
        </details>

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
