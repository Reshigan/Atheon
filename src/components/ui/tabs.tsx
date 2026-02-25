import { cn } from "@/lib/utils";
import { type ReactNode, useState } from "react";

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('flex gap-0.5 overflow-x-auto scrollbar-thin', className)} style={{ borderBottom: '1px solid var(--border-card)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-150 whitespace-nowrap border-b-2 -mb-px',
            activeTab === tab.id
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent t-muted hover:t-secondary hover:border-[var(--border-card)]'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded text-[10px]',
              activeTab === tab.id ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'bg-[var(--bg-secondary)] t-muted'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface TabPanelProps {
  children: ReactNode;
  className?: string;
}

export function TabPanel({ children, className }: TabPanelProps) {
  return <div className={cn('mt-4', className)}>{children}</div>;
}

export function useTabState(defaultTab: string) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return { activeTab, setActiveTab };
}
