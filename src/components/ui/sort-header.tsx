import type { JSX } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';
export interface SortSpec<K extends string = string> { key: K; dir: SortDir }

interface SortHeaderProps<K extends string> {
  sortKey: K;
  label: string;
  sort: SortSpec<K> | null;
  onSort: (k: K) => void;
  align?: 'left' | 'right';
  className?: string;
}

export function SortHeader<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  align = 'left',
  className,
}: SortHeaderProps<K>): JSX.Element {
  const active = sort?.key === sortKey;
  const dir = active ? sort?.dir : null;
  const ariaSort: 'none' | 'ascending' | 'descending' =
    !active ? 'none' : dir === 'asc' ? 'ascending' : 'descending';
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1.5 uppercase tracking-wider text-caption transition-colors ${
          active ? 't-primary' : 't-muted hover:t-primary'
        }`}
        title={
          !active
            ? `Sort by ${label}`
            : dir === 'asc'
              ? `Sorted by ${label} (asc) — click for desc`
              : `Sorted by ${label} (desc) — click to clear`
        }
      >
        {align === 'right' ? (
          <>
            <Icon size={11} style={active ? { color: 'var(--accent)' } : undefined} aria-hidden="true" />
            {label}
          </>
        ) : (
          <>
            {label}
            <Icon size={11} style={active ? { color: 'var(--accent)' } : undefined} aria-hidden="true" />
          </>
        )}
      </button>
    </th>
  );
}

export function cycleSort<K extends string>(prev: SortSpec<K> | null, key: K): SortSpec<K> | null {
  if (!prev || prev.key !== key) return { key, dir: 'asc' };
  if (prev.dir === 'asc') return { key, dir: 'desc' };
  return null;
}
