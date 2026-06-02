import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pablooverton.com'),
  title: 'Lump Slam: Retirement Planning',
  description: 'Professional retirement planning built on real math.',
  openGraph: {
    type: 'website',
    siteName: 'Lump Slam',
    title: 'Lump Slam: Retirement Planning',
    description:
      'Retirement math you can verify, line by line. Monte Carlo simulation, Roth-conversion timing, and IRMAA modeling, all in your browser.',
    url: 'https://www.pablooverton.com/lumpslam/',
    images: [{ url: 'https://www.pablooverton.com/lumpslam/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lump Slam: Retirement Planning',
    description: 'Retirement math you can verify, line by line.',
    images: ['https://www.pablooverton.com/lumpslam/og.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
