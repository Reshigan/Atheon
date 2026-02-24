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
    <div className={cn('flex gap-1 p-1 rounded-lg bg-gray-100 border border-gray-200', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
            activeTab === tab.id
                            ? 'bg-white text-indigo-700 border border-indigo-200 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-white/60 border border-transparent'
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              'ml-1 px-1.5 py-0.5 rounded-full text-xs',
              activeTab === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500'
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
