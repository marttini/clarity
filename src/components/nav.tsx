"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export type NavItem = { href: string; label: string };

export function MainNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="flex flex-wrap gap-0.5">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "inline-flex min-h-11 items-center rounded-lg px-3 text-sm no-underline",
              active ? "bg-line font-semibold text-white" : "font-medium text-muted hover:text-white",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
