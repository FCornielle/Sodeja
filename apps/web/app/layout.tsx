import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SODEJA — Estudio de Ubicación Comercial",
  description: "Evaluación de ubicaciones comerciales en República Dominicana.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="h-full bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
