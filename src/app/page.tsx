import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-white mb-3">Lump Slam</h1>
      <p className="text-gray-400 mb-8 text-lg">
        Professional retirement planning built on real math — not guesswork.
      </p>

      <div className="grid gap-4">
        <Link
          href="/profile"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">1. Enter Your Profile</h2>
          <p className="text-gray-400 text-sm">Ages, assets, spending goals, and life expectancy.</p>
        </Link>
        <Link
          href="/scenarios"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">2. Run Scenarios</h2>
          <p className="text-gray-400 text-sm">Retire now vs. your stated date vs. status quo.</p>
        </Link>
        <Link
          href="/seasons"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">3. Four Seasons Strategy</h2>
          <p className="text-gray-400 text-sm">COBRA → ACA → Medicare → RMDs, year by year.</p>
        </Link>
        <Link
          href="/roth"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">4. Roth Conversion Engine</h2>
          <p className="text-gray-400 text-sm">Minimize the tax torpedo on your pre-tax accounts.</p>
        </Link>
        <Link
          href="/social-security"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">5. Social Security Timing</h2>
          <p className="text-gray-400 text-sm">Optimal claim age based on lifetime benefit analysis.</p>
        </Link>
        <Link
          href="/opportunities"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">6. Optimization Opportunities</h2>
          <p className="text-gray-400 text-sm">Which of the six levers apply to your situation.</p>
        </Link>
        <Link
          href="/contingency"
          className="block p-6 rounded-lg border border-gray-700 hover:border-blue-500 transition-colors bg-gray-900"
        >
          <h2 className="font-semibold text-white mb-1">7. Contingency Planning</h2>
          <p className="text-gray-400 text-sm">Six risks and the widow's tax penalty, modeled.</p>
        </Link>
      </div>
    </div>
  );
}
