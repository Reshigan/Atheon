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
    <div className={cn('flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm overflow-x-auto scrollbar-thin', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0',
            activeTab === tab.id
              ? 'bg-white/[0.08] text-cyan-400 border border-white/[0.1] shadow-sm backdrop-blur-sm'
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent'
          )}
        >
          {tab.icon}
          <span className="hidden sm:inline">{tab.label}</span>
          <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
          {tab.count !== undefined && (
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded-full text-xs',
              activeTab === tab.id ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/[0.06] text-gray-500'
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
