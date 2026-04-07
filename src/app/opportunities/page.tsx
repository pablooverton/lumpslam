'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency } from '@/lib/format';
import Link from 'next/link';

export default function OpportunitiesPage() {
  const { opportunities } = useSimulationStore();
  const { profile } = useProfileStore();

  if (!opportunities || !profile) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Optimization Opportunities</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-2">Optimization Opportunities</h1>
      <p className="text-gray-400 text-sm mb-2">
        {opportunities.applicableCount} of {opportunities.assessments.length} opportunities apply
        to your situation.
      </p>
      {opportunities.totalEstimatedLifetimeValue > 0 && (
        <p className="text-green-400 text-sm font-medium mb-6">
          Estimated lifetime value:{' '}
          {formatCurrency(opportunities.totalEstimatedLifetimeValue)}
        </p>
      )}

      <div className="space-y-3">
        {opportunities.assessments.map((a) => (
          <div
            key={a.id}
            className={`rounded-lg border p-4 ${
              a.applicable
                ? 'border-green-800 bg-green-950/30'
                : 'border-gray-700 bg-gray-900'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      a.applicable
                        ? 'bg-green-700 text-green-100'
                        : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {a.applicable ? 'Applicable' : 'Not Applicable'}
                  </span>
                  <span className="font-medium text-white text-sm">{a.label}</span>
                </div>
                <p className="text-gray-400 text-sm">{a.reason}</p>
              </div>
              {a.estimatedLifetimeValue != null && (
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500">Est. lifetime value</p>
                  <p className="text-green-400 font-semibold">
                    {formatCurrency(a.estimatedLifetimeValue)}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
