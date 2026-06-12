'use client';

import { useEffect, useRef, useState } from 'react';
import type { PersonProfile } from '@/domain/types/profile';
import type { Account } from '@/domain/types/assets';

export const inputClass =
  'w-full h-9 bg-gray-800 border border-gray-700 rounded px-2.5 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors';

export const selectClass =
  'w-full h-9 bg-gray-800 border border-gray-700 rounded px-2 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800">
        <h2 className="font-semibold text-white text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

// Numeric input that stores raw string internally — avoids leading-zero and
// cursor-position problems with controlled <input type="number">.
export function NumericInput({
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

export function CurrencyInput({
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

export function PersonFields({
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
            <span className="text-gray-600">Find this on your Social Security statement at ssa.gov/myaccount.</span>{' '}
            <span className="text-gray-600">
              Retiring early? The statement assumes you keep earning until claim age — use ssa.gov&rsquo;s
              detailed calculator with future earnings set to $0, or apply the SS haircut under Advanced Settings.
            </span>
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

export function AccountRow({
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
          <option value="hsa">HSA</option>
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
