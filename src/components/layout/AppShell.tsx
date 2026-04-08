'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProfileStore } from '@/store/profile.store';
import { useSimulationStore } from '@/store/simulation.store';
import { buildMarkdownExport } from '@/lib/export-markdown';

const NAV_ITEMS = [
  { href: '/profile',         label: 'Profile & Assets' },
  { href: '/scenarios',       label: 'Scenarios' },
  { href: '/seasons',         label: 'Four Seasons' },
  { href: '/roth',            label: 'Roth Conversions' },
  { href: '/social-security', label: 'Social Security' },
  { href: '/opportunities',   label: 'Opportunities' },
  { href: '/contingency',     label: 'Contingency' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, assets, spending } = useProfileStore();
  const { scenarios, ssComparison, opportunities } = useSimulationStore();

  function handleExport() {
    if (!profile || !assets || !spending || scenarios.length === 0) return;
    const md = buildMarkdownExport({
      profile,
      assets,
      spending,
      accounts: assets.accounts,
      scenarios,
      ssComparison,
      opportunities,
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const names = profile.spouse
      ? `${profile.client.name}-${profile.spouse.name}`
      : profile.client.name;
    a.download = `lumpslam-${names.toLowerCase()}-${profile.currentYear}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canExport = !!profile && !!assets && !!spending && scenarios.length > 0;

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      <nav className="w-56 shrink-0 border-r border-gray-800 p-4 flex flex-col gap-1">
        <Link href="/" className="text-lg font-semibold text-white mb-6 block">
          Lump Slam
        </Link>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-2 rounded text-sm transition-colors ${
              pathname === item.href
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {item.label}
          </Link>
        ))}
        <div className="mt-auto pt-6">
          <button
            onClick={handleExport}
            disabled={!canExport}
            title={canExport ? 'Download full report as Markdown' : 'Run a simulation first'}
            className="w-full px-3 py-2 rounded text-sm text-left transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-2"
          >
            <span>↓</span>
            <span>Export Markdown</span>
          </button>
        </div>
      </nav>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
