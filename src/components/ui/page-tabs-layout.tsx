/**
 * <PageTabsLayout> — header + tabs + URL-sync wrapper.
 *
 * Wraps the existing <Tabs> primitive with three things every page that
 * has tabs ends up rewriting:
 *
 *   1. A header slot above the tabstrip (page title, actions, refresh).
 *   2. Optional URL sync — push activeTab into `?tab=` so deep links work
 *      and the back button respects tab state. Two modes:
 *        - `'persistent'`: writes the param on every change and reads it
 *          on mount (default when syncToUrl is true).
 *        - `'consumed-once'`: reads `?tab=` on mount, applies it, then
 *          clears the param. Mirrors Catalysts's current behaviour where
 *          we want shareable deep-links but don't want the param to
 *          accumulate stale tab ids.
 *   3. A `variant` knob so Mind/Memory's pill-style segmented control can
 *      live under the same component without diverging.
 *
 * Usage:
 *
 *   <PageTabsLayout
 *     ariaLabel="Apex sections"
 *     tabs={[{ id: 'health', label: 'Health' }, { id: 'briefing', label: 'Briefing' }]}
 *     activeTab={tab}
 *     onTabChange={setTab}
 *     header={<PageHeader title="Apex" actions={<RefreshButton/>} />}
 *     syncToUrl="persistent"
 *   >
 *     {tab === 'health' && <HealthPanel />}
 *     {tab === 'briefing' && <BriefingPanel />}
 *   </PageTabsLayout>
 *
 * The `<TabPanel>` primitive is still available — wrap your panels in
 * it when you want ARIA tabpanel semantics. PageTabsLayout intentionally
 * does NOT auto-wrap children so pages can still hand-control tabpanel
 * mounting/unmounting (e.g. keep-mounted vs lazy panels).
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tabs } from "./tabs";

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  panelId?: string;
}

export type TabsVariant = 'underline' | 'segmented';

export type SyncToUrl = false | true | 'persistent' | 'consumed-once';

interface PageTabsLayoutProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Rendered above the tabstrip — page title, actions, breadcrumbs. */
  header?: ReactNode;
  /** Accessible label for the tablist. Defaults to "Page sections". */
  ariaLabel?: string;
  /**
   * URL sync mode. `true` === `'persistent'`. `'consumed-once'` reads
   * `?tab=` on mount, applies it, then strips the param. Default: `false`.
   */
  syncToUrl?: SyncToUrl;
  /** Query param name to sync. Defaults to `tab`. */
  syncParam?: string;
  /** Visual style of the tabstrip. `underline` mirrors today's <Tabs>;
   *  `segmented` ports the Mind/Memory pill style under one roof. */
  variant?: TabsVariant;
  /** Tab panels — usually `{activeTab === 'x' && <Panel />}` blocks
   *  wrapped in <TabPanel>. */
  children: ReactNode;
  className?: string;
  tabsClassName?: string;
}

export function PageTabsLayout({
  tabs,
  activeTab,
  onTabChange,
  header,
  ariaLabel,
  syncToUrl = false,
  syncParam = 'tab',
  variant = 'underline',
  children,
  className,
  tabsClassName,
}: PageTabsLayoutProps) {
  const mode: 'off' | 'persistent' | 'consumed-once' =
    syncToUrl === false
      ? 'off'
      : syncToUrl === true || syncToUrl === 'persistent'
        ? 'persistent'
        : 'consumed-once';

  const [searchParams, setSearchParams] = useSearchParams();
  const consumedOnceRef = useRef(false);

  // Read URL → state on mount (and whenever the URL param changes in
  // persistent mode). For consumed-once we only fire once.
  useEffect(() => {
    if (mode === 'off') return;
    const fromUrl = searchParams.get(syncParam);
    if (!fromUrl) return;
    if (mode === 'consumed-once' && consumedOnceRef.current) return;

    const known = tabs.some((t) => t.id === fromUrl);
    if (known && fromUrl !== activeTab) onTabChange(fromUrl);

    if (mode === 'consumed-once') {
      consumedOnceRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete(syncParam);
      setSearchParams(next, { replace: true });
    }
    // We intentionally don't depend on activeTab — that would cause a
    // write-loop when the user navigates manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, syncParam]);

  // State → URL in persistent mode.
  useEffect(() => {
    if (mode !== 'persistent') return;
    const current = searchParams.get(syncParam);
    if (current === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set(syncParam, activeTab);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mode]);

  const handleChange = useCallback(
    (id: string) => {
      onTabChange(id);
    },
    [onTabChange],
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {header}
      {variant === 'underline' ? (
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={handleChange}
          ariaLabel={ariaLabel}
          className={tabsClassName}
        />
      ) : (
        <SegmentedTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={handleChange}
          ariaLabel={ariaLabel}
          className={tabsClassName}
        />
      )}
      {children}
    </div>
  );
}

// ─── Segmented (pill) variant ────────────────────────────────────
//
// Ported from the bespoke control in MindPage / MemoryPage so they can
// migrate without losing the visual identity. Keeps the same ARIA
// contract as <Tabs>.

interface SegmentedTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

function SegmentedTabs({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
  className,
}: SegmentedTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel || 'Page sections'}
      className={cn(
        'inline-flex p-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)] gap-0.5',
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`${tab.id}-tab`}
            aria-selected={isActive}
            aria-controls={tab.panelId || `${tab.id}-panel`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-body-sm font-medium whitespace-nowrap',
              'transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-primary)]',
              isActive
                ? 'bg-[var(--bg-card)] text-accent shadow-sm border border-[var(--border-card)]'
                : 't-muted hover:t-secondary',
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn(
                  'ml-1 px-1.5 py-0.5 rounded text-caption',
                  isActive
                    ? 'bg-[var(--accent-subtle)] text-accent'
                    : 'bg-[var(--bg-primary)] t-muted',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
