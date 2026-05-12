/**
 * MetricFilterBar — Pulse metrics list filter (search + status + category).
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.2.1. Now a thin wrapper over the
 * canonical {@link FilterBar} base — keeps the public prop shape that
 * PulsePage already consumes while sharing the pill / search / "Showing
 * X of Y" rendering with RunItemsFilterBar (and any future filter UIs).
 */
import { FilterBar, type FilterOption } from "./FilterBar";

export type MetricStatus = "green" | "amber" | "red";

interface MetricFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: MetricStatus[];
  onStatusFilterChange: (next: MetricStatus[]) => void;
  categoryFilter: string[];
  onCategoryFilterChange: (next: string[]) => void;
  availableCategories: string[];
  resultCount: number;
  totalCount: number;
}

const STATUS_OPTIONS: FilterOption<MetricStatus>[] = [
  { value: "red", label: "Red", dotClass: "bg-red-500" },
  { value: "amber", label: "Amber", dotClass: "bg-amber-500" },
  { value: "green", label: "Green", dotClass: "bg-emerald-500" },
];

export function MetricFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  availableCategories,
  resultCount,
  totalCount,
}: MetricFilterBarProps) {
  const sections = [
    {
      label: 'Status',
      options: STATUS_OPTIONS as FilterOption<string>[],
      selected: statusFilter as string[],
      onChange: (next: string[]) => onStatusFilterChange(next as MetricStatus[]),
    },
    ...(availableCategories.length > 0
      ? [{
          label: 'Category',
          options: availableCategories.map((c) => ({ value: c, label: c })),
          selected: categoryFilter,
          onChange: onCategoryFilterChange,
        }]
      : []),
  ];

  return (
    <FilterBar
      search={{
        value: searchQuery,
        onChange: onSearchChange,
        placeholder: 'Search metrics…',
        ariaLabel: 'Search metrics',
      }}
      result={{ count: resultCount, total: totalCount, noun: 'metric' }}
      sections={sections}
      // Original UI kept status on the same row as search to maximise
      // horizontal density; preserve that with inline layout.
      layout="inline"
    />
  );
}
