import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Clarity", template: "%s · Clarity" },
  description: "Síntese Clarity: projetos, tarefas, horas e clientes em um só lugar.",
};

export const viewport: Viewport = { themeColor: "#120A19", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
