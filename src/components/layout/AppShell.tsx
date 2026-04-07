'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
      </nav>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
