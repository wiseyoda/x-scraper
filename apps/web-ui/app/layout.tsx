import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'x-scraper',
  description: 'Local-first knowledge graph from your X.com bookmarks.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
