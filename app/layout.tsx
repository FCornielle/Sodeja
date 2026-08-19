import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Esodeja',
  description:
    'Estudios de mercado geograficos para Republica Dominicana sobre Google Maps Platform',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
