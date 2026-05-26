/**
 * FilterBar — canonical search + multi-select filter pattern.
 *
 * Replaces the near-identical ~90% copy-paste in MetricFilterBar and
 * RunItemsFilterBar (and any future filter UIs) with one config-driven
 * component. Use named-slot composition for the search header + one
 * `Section` per filter group.
 *
 * Example:
 *
 *   <FilterBar
 *     search={{ value: q, onChange: setQ, placeholder: 'Search items…' }}
 *     result={{ count: filtered.length, total: items.length, noun: 'items' }}
 *     sections={[
 *       { label: 'Status', selected: status, onChange: setStatus, options: STATUS_OPTIONS },
 *       { label: 'Severity', selected: severity, onChange: setSeverity, options: SEVERITY_OPTIONS },
 *     ]}
 *   />
 *
 * Each Section's `options` is `{ value, label, dotClass? }[]`. `dotClass`
 * paints a small coloured dot before the label — leave undefined for plain
 * pill (the source_system category pattern in MetricFilterBar uses this).
 *
 * Clear-all is implicit: when any search or section has a value, a
 * "Clear" link appears next to the result count.
 */
import { Search, Filter, X } from "lucide-react";

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  /** Tailwind class for a small leading dot. Omit for plain pill. */
  dotClass?: string;
}

export interface FilterSection<T extends string = string> {
  label: string;
  options: FilterOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  /** Hide the leading filter-icon. Useful for stacked sections beyond
   *  the first — the icon only really belongs in the first row. */
  hideIcon?: boolean;
}

export interface FilterBarProps {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    ariaLabel?: string;
  };
  result?: {
    count: number;
    total: number;
    /** Noun used in "Showing X of Y items". Auto-pluralised. */
    noun?: string;
  };
  /** Each filter section renders as a row of toggleable pills. */
  sections: FilterSection<string>[];
  /** Layout: 'inline' keeps the first section on the same row as search;
   *  'stacked' (default) puts every section on its own row. */
  layout?: 'inline' | 'stacked';
  className?: string;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterBar({
  search, result, sections, layout = 'stacked', className = '',
}: FilterBarProps) {
  const hasActive =
    (search?.value?.length ?? 0) > 0 ||
    sections.some((s) => s.selected.length > 0);

  const clearAll = () => {
    search?.onChange('');
    for (const s of sections) s.onChange([]);
  };

  // For inline layout the first section sits on the same row as search.
  const inlineSection = layout === 'inline' ? sections[0] : null;
  const rowSections = layout === 'inline' ? sections.slice(1) : sections;

  return (
    <div className={`space-y-2 mb-4 ${className}`}>
      {/* Search + result count + (inline-mode) first section */}
      <div className="flex flex-wrap items-center gap-3">
        {search && (
          <div className="relative flex-1 min-w-48 max-w-md">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              aria-label={search.ariaLabel ?? 'Search'}
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-body t-primary focus:outline-none focus:border-accent/40"
              placeholder={search.placeholder ?? 'Search…'}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
            {search.value && (
              <button
                type="button"
                onClick={() => search.onChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:t-primary"
                aria-label="Clear search"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {inlineSection && (
          <PillRow section={inlineSection} showIcon />
        )}

        {result && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-caption t-muted whitespace-nowrap">
              Showing{' '}
              <span className="t-primary font-medium">{result.count}</span> of{' '}
              <span className="t-primary font-medium">{result.total}</span>{' '}
              {result.noun ?? 'item'}{result.total !== 1 ? 's' : ''}
            </span>
            {hasActive && (
              <button
                type="button"
                onClick={clearAll}
                className="text-caption link-accent"
                title="Clear all filters"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Remaining sections — each on its own row */}
      {rowSections.map((section, idx) => (
        <PillRow
          key={section.label}
          section={section}
          // First stacked section gets the filter icon; subsequent ones
          // align under the label column for a clean visual rhythm.
          showIcon={layout === 'stacked' && idx === 0 && !section.hideIcon}
        />
      ))}
    </div>
  );
}

// ─── Internal: a single labelled row of toggleable pills ────────

function PillRow({
  section, showIcon,
}: { section: FilterSection<string>; showIcon: boolean }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {showIcon ? (
        <Filter size={14} className="text-gray-400" aria-hidden="true" />
      ) : (
        <span className="w-[14px]" aria-hidden="true" />
      )}
      <span className="text-label mr-1">{section.label}:</span>
      {section.options.map((opt) => {
        const active = section.selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => section.onChange(toggle(section.selected, opt.value))}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-caption font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
              active
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400'
            } active:scale-[0.97]`}
          >
            {opt.dotClass && (
              <span className={`w-2 h-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
