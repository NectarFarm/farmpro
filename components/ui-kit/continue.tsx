'use client';
// ── Continue (ui-kit) — adapted from the reference's
// src/components/chrome/continue.tsx. The reference version took `to` strings
// and rendered TanStack Router <Link>s; this app navigates via useNav()'s
// navigate() function (components/farm/navigation.tsx), not <a href>, so this
// version takes an `onClick` per item instead of a route string. Quiet
// next-step strip so a screen can hand off to 2-4 related destinations
// instead of dumping the user back at the top level.
export function Continue({
  items,
}: {
  items: { label: string; hint: string; onClick: () => void }[];
}) {
  return (
    <nav className="mt-8 border-t border-border pt-5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">Then</p>
      <ul className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.label}>
            <button type="button" onClick={item.onClick} className="group block text-left">
              <span className="text-sm font-medium text-primary group-hover:underline">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
