import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Globe2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

/**
 * Company switcher for multi-company tenants.
 *
 * Backed by PR #219 (erp_companies), PR #220 (vendor-id capture) and PR #232
 * (catalysts accept ?company_id= scoping). Renders nothing when the tenant has
 * <= 1 company — single-company tenants don't need the UI.
 *
 * Selecting "All Companies" = consolidated (selectedCompanyId = null).
 * Selection persists in localStorage via the app store.
 */
export function CompanySwitcher() {
  const companies = useAppStore((s) => s.companies);
  const selectedCompanyId = useAppStore((s) => s.selectedCompanyId);
  const setSelectedCompanyId = useAppStore((s) => s.setSelectedCompanyId);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Hide the switcher entirely for single-company tenants.
  if (companies.length <= 1) return null;

  const selected = selectedCompanyId ? companies.find((c) => c.id === selectedCompanyId) : null;
  const label = selected ? selected.name : 'All Companies';

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer hover:bg-[var(--bg-tertiary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
        title={selected ? `Scoped to ${selected.name}` : 'All companies (consolidated)'}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <Building2 size={12} className="flex-shrink-0 t-muted" />
        ) : (
          <Globe2 size={12} className="flex-shrink-0 t-muted" />
        )}
        <span className="text-caption font-medium t-secondary truncate max-w-[180px]">{label}</span>
        <ChevronDown size={10} className="flex-shrink-0 t-muted" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-72 rounded-lg overflow-hidden z-50"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-dropdown)' }}
          role="listbox"
        >
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-card)' }}>
            <p className="text-caption font-medium t-muted uppercase tracking-wider">Scope To Company</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <button
              onClick={() => {
                setSelectedCompanyId(null);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:bg-[var(--bg-secondary)] flex items-center gap-2.5"
              style={selectedCompanyId === null ? { background: 'var(--accent-subtle)' } : undefined}
              role="option"
              aria-selected={selectedCompanyId === null}
            >
              <Globe2 size={13} className={selectedCompanyId === null ? 'text-accent flex-shrink-0' : 't-muted flex-shrink-0'} />
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] leading-tight truncate ${selectedCompanyId === null ? 'font-medium t-primary' : 't-secondary'}`}>
                  All Companies
                </p>
                <p className="text-caption t-muted">Consolidated across all companies</p>
              </div>
              {selectedCompanyId === null && <Check size={12} className="text-accent flex-shrink-0" />}
            </button>

            {companies.map((co) => {
              const isActive = co.id === selectedCompanyId;
              const codePart = co.code ? `${co.code} — ` : '';
              return (
                <button
                  key={co.id}
                  onClick={() => {
                    setSelectedCompanyId(co.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:bg-[var(--bg-secondary)] flex items-center gap-2.5"
                  style={isActive ? { background: 'var(--accent-subtle)' } : undefined}
                  role="option"
                  aria-selected={isActive}
                >
                  <Building2 size={13} className={isActive ? 'text-accent flex-shrink-0' : 't-muted flex-shrink-0'} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] leading-tight truncate ${isActive ? 'font-medium t-primary' : 't-secondary'}`}>
                      {codePart}{co.name}
                    </p>
                    <p className="text-caption t-muted truncate">
                      {co.is_primary ? 'Primary' : co.source_system}
                      {co.currency ? ` · ${co.currency}` : ''}
                      {co.country ? ` · ${co.country}` : ''}
                    </p>
                  </div>
                  {isActive && <Check size={12} className="text-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
