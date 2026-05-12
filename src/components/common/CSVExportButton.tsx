/**
 * §9.4 CSV Export Button
 * Reusable button that triggers CSV download from any endpoint.
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { API_URL, getToken, getTenantOverride } from "@/lib/api";

interface CSVExportButtonProps {
  endpoint: string;
  filename: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function CSVExportButton({ endpoint, filename, label = 'Export CSV', size = 'sm', className = '' }: CSVExportButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      let url = `${API_URL}${endpoint}${sep}format=csv`;
      const tenantOverride = getTenantOverride();
      if (tenantOverride && !url.includes('tenant_id=')) {
        url += `&tenant_id=${encodeURIComponent(tenantOverride)}`;
      }
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
    setDownloading(false);
  };

  const sizeClasses = size === 'sm'
    ? 'px-2.5 py-1 text-caption gap-1'
    : 'px-3 py-1.5 text-xs gap-1.5';

  return (
    <button
      onClick={handleExport}
      disabled={downloading}
      className={`inline-flex items-center ${sizeClasses} rounded-md font-medium t-muted hover:t-primary transition-all disabled:opacity-50 ${className}`}
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
      title={label}
    >
      {downloading ? <Loader2 size={size === 'sm' ? 11 : 13} className="animate-spin" /> : <Download size={size === 'sm' ? 11 : 13} />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
