/**
 * RunItemsFilterBar — CatalystRunDetail page items filter.
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.4.1. Thin wrapper over the canonical
 * {@link FilterBar} base — keeps the public prop shape that the page
 * already consumes while sharing the pill / search / result-count
 * rendering with MetricFilterBar.
 */
import { FilterBar, type FilterOption } from "./FilterBar";

export type ItemStatus = "matched" | "discrepancy" | "unmatched_source" | "unmatched_target" | "exception";
export type ReviewStatus = "pending" | "approved" | "rejected" | "deferred";
export type Severity = "low" | "medium" | "high" | "critical";

interface RunItemsFilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: ItemStatus[];
  onStatusFilterChange: (next: ItemStatus[]) => void;
  reviewFilter: ReviewStatus[];
  onReviewFilterChange: (next: ReviewStatus[]) => void;
  severityFilter: Severity[];
  onSeverityFilterChange: (next: Severity[]) => void;
  resultCount: number;
  totalCount: number;
}

const STATUS_OPTIONS: FilterOption<ItemStatus>[] = [
  { value: "matched", label: "Matched", dotClass: "bg-accent" },
  { value: "discrepancy", label: "Discrepancy", dotClass: "bg-[var(--warning)]" },
  { value: "unmatched_source", label: "Unmatched (Source)", dotClass: "bg-[var(--info)]" },
  { value: "unmatched_target", label: "Unmatched (Target)", dotClass: "bg-[var(--info)]" },
  { value: "exception", label: "Exception", dotClass: "bg-neg" },
];

const REVIEW_OPTIONS: FilterOption<ReviewStatus>[] = [
  { value: "pending", label: "Pending", dotClass: "bg-[var(--warning)]" },
  { value: "approved", label: "Approved", dotClass: "bg-accent" },
  { value: "rejected", label: "Rejected", dotClass: "bg-neg" },
  { value: "deferred", label: "Deferred", dotClass: "bg-[var(--warning)]" },
];

const SEVERITY_OPTIONS: FilterOption<Severity>[] = [
  { value: "low", label: "Low", dotClass: "bg-accent" },
  { value: "medium", label: "Medium", dotClass: "bg-[var(--warning)]" },
  { value: "high", label: "High", dotClass: "bg-[var(--warning)]" },
  { value: "critical", label: "Critical", dotClass: "bg-neg" },
];

export function RunItemsFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  reviewFilter,
  onReviewFilterChange,
  severityFilter,
  onSeverityFilterChange,
  resultCount,
  totalCount,
}: RunItemsFilterBarProps) {
  return (
    <FilterBar
      search={{
        value: searchQuery,
        onChange: onSearchChange,
        placeholder: 'Search by ref, entity, or discrepancy reason…',
        ariaLabel: 'Search items',
      }}
      result={{ count: resultCount, total: totalCount, noun: 'item' }}
      sections={[
        {
          label: 'Status',
          options: STATUS_OPTIONS as FilterOption<string>[],
          selected: statusFilter as string[],
          onChange: (next) => onStatusFilterChange(next as ItemStatus[]),
        },
        {
          label: 'Review',
          options: REVIEW_OPTIONS as FilterOption<string>[],
          selected: reviewFilter as string[],
          onChange: (next) => onReviewFilterChange(next as ReviewStatus[]),
        },
        {
          label: 'Severity',
          options: SEVERITY_OPTIONS as FilterOption<string>[],
          selected: severityFilter as string[],
          onChange: (next) => onSeverityFilterChange(next as Severity[]),
        },
      ]}
      // Original UI stacked all sections vertically so the long-noun
      // "Unmatched (Source)" pill could breathe; preserve that.
      layout="stacked"
    />
  );
}
