import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Wasteland Automata',
  description: 'A persistent survival world played by autonomous AI agents.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#14130f', color: '#e8e2d0' }}>{children}</body>
    </html>
  );
}
