/**
 * <Tabs> — ARIA-compliant tablist with keyboard arrow navigation.
 *
 * WCAG notes (C3):
 *   - The outer container has role="tablist" so AT announces the group.
 *   - Each button is role="tab" with aria-selected mirroring the active
 *     state, and aria-controls pointing at the panel id.
 *   - The inactive tabs are tabIndex=-1 so keyboard users can't tab into
 *     each one individually — they land on the active tab and move
 *     between tabs with Arrow keys (W3C tabs pattern).
 *   - <TabPanel> exposes role="tabpanel" and aria-labelledby so SR users
 *     hear which tab the panel belongs to.
 *
 * Behavioural notes:
 *   - Activation is "manual" not "follow focus": Arrow-Left/Right moves
 *     focus but doesn't change the active tab; Enter/Space activates.
 *     Auto-activation made the Pulse and Catalysts pages re-fetch on
 *     every arrow press, which felt sluggish on slow networks.
 *   - Home/End jump to first/last tab — useful when tab lists overflow.
 *   - Only animates compositor-friendly props on the active indicator;
 *     no `transition-all` (was hitting layout twice per render).
 */
import { cn } from "@/lib/utils";
import { type ReactNode, useState, useRef, useCallback, useEffect } from "react";

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  /** Optional override for the panel id this tab controls; defaults to `${id}-panel`. */
  panelId?: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
  /** Accessible label for the tablist — required for screen-reader clarity. */
  ariaLabel?: string;
}

function panelIdFor(tab: Tab): string {
  return tab.panelId || `${tab.id}-panel`;
}

export function Tabs({ tabs, activeTab, onTabChange, className, ariaLabel }: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTab),
  );

  const focusTabAt = useCallback((idx: number) => {
    const wrapped = ((idx % tabs.length) + tabs.length) % tabs.length;
    tabRefs.current[wrapped]?.focus();
  }, [tabs.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTabAt(idx + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTabAt(idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTabAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusTabAt(tabs.length - 1);
        break;
      // Enter/Space falls through to default onClick handling via the button.
    }
  }, [focusTabAt, tabs.length]);

  // Keep refs array sized to the tab list — React reuses refs across renders
  // but ref count must match button count.
  useEffect(() => {
    tabRefs.current = tabRefs.current.slice(0, tabs.length);
  }, [tabs.length]);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel || 'Page sections'}
      className={cn('flex gap-0.5 overflow-x-auto scrollbar-thin', className)}
      style={{ borderBottom: '1px solid var(--border-card)' }}
    >
      {tabs.map((tab, idx) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[idx] = el; }}
            role="tab"
            type="button"
            id={`${tab.id}-tab`}
            aria-selected={isActive}
            aria-controls={panelIdFor(tab)}
            tabIndex={idx === activeIndex ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px',
              'transition-[color,border-color,background-color] duration-150 [transition-timing-function:var(--ease-out)]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] focus-visible:rounded-sm',
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent t-muted hover:t-secondary hover:border-[var(--border-card)]',
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={cn(
                'ml-1 px-1.5 py-0.5 rounded text-caption',
                isActive ? 'bg-[var(--accent-subtle)] text-accent' : 'bg-[var(--bg-secondary)] t-muted',
              )}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  children: ReactNode;
  className?: string;
  /** When provided with activeTab, only renders when id === activeTab.
   *  The id also becomes the panel's DOM id so the matching tab's
   *  aria-controls resolves correctly. */
  id?: string;
  activeTab?: string;
}

export function TabPanel({ children, className, id, activeTab }: TabPanelProps) {
  if (id !== undefined && activeTab !== undefined && id !== activeTab) return null;
  const panelId = id ? `${id}-panel` : undefined;
  const labelledBy = id ? `${id}-tab` : undefined;
  return (
    <div
      className={cn('mt-4', className)}
      role={id ? 'tabpanel' : undefined}
      id={panelId}
      aria-labelledby={labelledBy}
      tabIndex={id ? 0 : undefined}
    >
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTabState(defaultTab: string) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return { activeTab, setActiveTab };
}
