"use client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** Linha de tabela que abre um destino ao clicar (o nome dentro dela continua sendo um link para teclado e leitor de tela). */
export function ClickableRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer hover:bg-surface-3 ${className ?? ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
