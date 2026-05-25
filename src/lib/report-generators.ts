/**
 * Client-side PDF and Excel report generators for Assessment reports.
 * These run in the browser using jsPDF and SheetJS (xlsx), avoiding
 * Cloudflare Workers runtime compatibility issues with these libraries.
 *
 * Branding: Atheon Intelligence Platform (headers/cover)
 *           VantaX (Pty) Ltd - Powered by Atheon (footer)
 */
import type {
  Assessment,
  AssessmentResults,
  ValueAssessmentFinding,
  DataQualityRecord,
  ProcessTimingRecord,
  ValueSummaryRecord,
} from './api';
import { formatDays } from './utils';

// -- Helpers -----------------------------------------------------------------

function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(Math.round(amount));
}

function formatRk(n: number): string {
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R ${Math.round(n / 1_000)}k`;
  return `R ${formatZAR(n)}`;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

// Colour palette shared across all reports
const NAVY  = [27, 58, 107] as const;
const TEAL  = [0, 150, 136] as const;
const GOLD  = [255, 179, 0] as const;
const SLATE = [55, 71, 79] as const;
const LIGHT = [245, 248, 255] as const;
const WHITE = [255, 255, 255] as const;
const RED   = [211, 47, 47] as const;
const GREEN = [46, 125, 50] as const;

// ============================================================================
// 1. BUSINESS CASE PDF
// ============================================================================

export async function generateBusinessPDF(assessment: Assessment): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const results = assessment.results as AssessmentResults | null;
  const scores = results?.catalyst_scores ?? [];
  const sizing = results?.technical_sizing;
  const config = assessment.config as Record<string, unknown>;
  const snapshot = (results?.volume_snapshot ?? assessment.dataSnapshot ?? {}) as Record<string, unknown>;

  if (scores.length === 0) {
    alert('No catalyst scores available to generate report.');
    return;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const prospectName = assessment.prospectName || 'Prospect';

  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const deploymentModel = str(config.deployment_model, 'saas');
  const annualLicence = sizing
    ? (deploymentModel === 'saas'
      ? sizing.annual_licence_revenue
      : deploymentModel === 'hybrid' ? num(config.hybrid_licence_fee_pa) : num(config.onprem_licence_fee_pa))
    : 0;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  function pageHeader(title: string) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...TEAL);
    doc.rect(0, 18, pageW, 1.5, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(13);
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.text(`${prospectName} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  function pageFooter() {
    doc.setFillColor(...NAVY);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setFontSize(6);
    doc.setTextColor(180, 200, 230);
    doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform', 14, pageH - 5);
    doc.text(`Generated ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`, pageW - 14, pageH - 5, { align: 'right' });
  }

  // ===== PAGE 1 - Cover =====
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(0, 85, pageW, 3, 'F');

  doc.setTextColor(...WHITE);
  doc.setFontSize(42);
  doc.text('ATHEON', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(11);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 62, { align: 'center' });
  doc.setFillColor(...GOLD);
  doc.rect(pageW / 2 - 30, 68, 60, 0.8, 'F');

  doc.setFontSize(20);
  doc.text('AI Catalyst Assessment', pageW / 2, 105, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Business Case & Value Proposition', pageW / 2, 115, { align: 'center' });

  doc.setFontSize(16);
  doc.text(prospectName, pageW / 2, 140, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 160, { align: 'center' });
  doc.text(`ERP System: ${str(snapshot.erp_system, 'N/A')}`, pageW / 2, 168, { align: 'center' });
  doc.text(`Data Period: ${num(snapshot.months_of_data)} months of transaction data`, pageW / 2, 176, { align: 'center' });
  doc.text('CONFIDENTIAL - For Authorised Recipients Only', pageW / 2, 195, { align: 'center' });

  // VantaX footer on cover
  doc.setFillColor(...GOLD);
  doc.rect(0, pageH - 14, pageW, 14, 'F');
  doc.setTextColor(...NAVY);
  doc.setFontSize(8);
  doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform | www.gonxt.tech', pageW / 2, pageH - 5, { align: 'center' });

  // ===== PAGE 2 - Executive Summary =====
  doc.addPage();
  pageHeader('Executive Summary');

  const kpis = [
    { label: 'Total Est. Annual Savings', value: `R ${formatZAR(totalSaving)}`, color: TEAL },
    { label: 'AI Catalysts Identified', value: `${scores.length}`, color: NAVY },
    { label: 'Payback Period', value: `${paybackMonths} months`, color: GOLD },
    { label: 'Return on Investment', value: `${roi}%`, color: TEAL },
    { label: 'Recommended First Catalyst', value: scores[0]?.catalyst_name || 'N/A', color: NAVY },
    { label: 'Data Completeness', value: `${num(snapshot.data_completeness_pct)}%`, color: GOLD },
  ];

  const kpiW = (pageW - 30) / 3;
  kpis.forEach((kpi, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 10 + col * (kpiW + 5);
    const ky = 28 + row * 30;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(x, ky, kpiW, 25, 2, 2, 'F');
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(x, ky, 2, 25, 'F');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(kpi.label, x + 6, ky + 8);
    doc.setFontSize(14);
    doc.setTextColor(...SLATE);
    const valText = doc.splitTextToSize(kpi.value, kpiW - 10);
    doc.text(valText[0], x + 6, ky + 19);
  });

  let y = 95;
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text('Assessment Overview', 14, y);
  y += 2;
  doc.setFillColor(...TEAL);
  doc.rect(14, y, 30, 0.5, 'F');
  y += 7;

  const narrative = str(results?.narrative, `This assessment identified ${scores.length} AI catalysts with a combined estimated annual saving of R ${formatZAR(totalSaving)}. The recommended first deployment is ${scores[0]?.catalyst_name || 'N/A'} with the highest return potential.`);
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  const narrativeLines = doc.splitTextToSize(narrative, pageW - 28);
  doc.text(narrativeLines, 14, y);
  y += narrativeLines.length * 4.5 + 8;

  // Data source box
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(14, y, pageW - 28, 18, 2, 2, 'F');
  doc.setFillColor(...NAVY);
  doc.rect(14, y, 2, 18, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text('DATA SOURCE', 20, y + 6);
  doc.setTextColor(...SLATE);
  doc.text(`${str(snapshot.erp_system, 'ERP')} | ${num(snapshot.months_of_data)} months | ${num(snapshot.monthly_invoices)} invoices/month | ${num(snapshot.employee_count)} employees | ${num(snapshot.active_customer_count)} customers`, 20, y + 13);
  pageFooter();

  // ===== PAGE 3 - Savings by Catalyst =====
  doc.addPage();
  pageHeader('Savings by Catalyst');

  y = 28;
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('Estimated Annual Savings by AI Catalyst', 14, y);
  y += 8;

  const maxSaving = Math.max(...scores.map(s => s.estimated_annual_saving_zar), 1);
  const barMaxW = pageW - 90;
  const barColors = [[0,150,136],[27,58,107],[255,179,0],[76,175,80],[156,39,176],[233,30,99],[63,81,181]] as const;

  scores.forEach((cat, idx) => {
    const barW = (cat.estimated_annual_saving_zar / maxSaving) * barMaxW;
    const color = barColors[idx % barColors.length];
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    const labelLines = doc.splitTextToSize(cat.catalyst_name, 55);
    doc.text(labelLines[0], 14, y + 4);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(72, y, Math.max(barW, 2), 7, 1, 1, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...SLATE);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, 72 + Math.max(barW, 2) + 3, y + 5);
    y += 12;
  });

  // Summary table
  y += 8;
  doc.setFillColor(...NAVY);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  const tCols = ['#', 'Catalyst', 'Domain', 'Sub-Catalysts', 'Est. Annual Saving', 'Confidence'];
  const tX = [16, 24, 68, 100, 145, 182];
  tCols.forEach((col, i) => doc.text(col, tX[i], y + 5.5));

  y += 10;
  doc.setTextColor(...SLATE);
  scores.forEach((cat, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(...LIGHT);
      doc.rect(14, y - 3.5, pageW - 28, 7, 'F');
    }
    doc.setFontSize(7);
    doc.text(`${cat.priority}`, tX[0], y);
    doc.text(cat.catalyst_name.substring(0, 25), tX[1], y);
    doc.text(cat.domain, tX[2], y);
    doc.text(`${cat.sub_catalysts.length}`, tX[3], y);
    doc.setTextColor(...NAVY);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, tX[4], y);
    const confColor = cat.confidence === 'high' ? TEAL : cat.confidence === 'medium' ? GOLD : [200,200,200] as const;
    doc.setFillColor(confColor[0], confColor[1], confColor[2]);
    doc.roundedRect(tX[5], y - 3, 14, 5, 1, 1, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(6);
    doc.text(cat.confidence.toUpperCase(), tX[5] + 2, y);
    doc.setTextColor(...SLATE);
    doc.setFontSize(7);
    y += 7;
  });

  y += 2;
  doc.setFillColor(...TEAL);
  doc.rect(14, y - 3.5, pageW - 28, 8, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(9);
  doc.text('TOTAL ESTIMATED ANNUAL SAVINGS', 16, y + 1);
  doc.text(`R ${formatZAR(totalSaving)}`, tX[4], y + 1);
  pageFooter();

  // ===== PAGES 4-N - Catalyst Deep Dives (top 5) =====
  const topCatalysts = scores.slice(0, 5);
  for (const cat of topCatalysts) {
    doc.addPage();
    pageHeader(`Catalyst Deep Dive: ${cat.catalyst_name}`);

    let py = 26;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(14, py, pageW - 28, 16, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(`Domain: ${cat.domain}`, 18, py + 6);
    doc.text(`Priority: ${cat.priority}`, 80, py + 6);
    doc.text(`Confidence: ${cat.confidence.toUpperCase()}`, 120, py + 6);
    doc.setTextColor(...NAVY);
    doc.text(`Est. Annual Saving: R ${formatZAR(cat.estimated_annual_saving_zar)}`, 18, py + 13);
    py += 22;

    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('Key Data Insights', 14, py);
    doc.setFillColor(...TEAL);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    for (const insight of cat.data_insights) {
      doc.setFillColor(...TEAL);
      doc.circle(17, py - 1, 1, 'F');
      const lines = doc.splitTextToSize(insight, pageW - 36);
      doc.text(lines, 22, py);
      py += lines.length * 4 + 3;
    }

    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('Savings Breakdown', 14, py);
    doc.setFillColor(...TEAL);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    const catMaxSave = Math.max(...cat.saving_components.map(c => c.amount_zar), 1);
    for (const comp of cat.saving_components) {
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(comp.label, 18, py);
      doc.text(`R ${formatZAR(comp.amount_zar)}`, 130, py);
      const miniBarW = (comp.amount_zar / catMaxSave) * 50;
      doc.setFillColor(...TEAL);
      doc.roundedRect(150, py - 3, Math.max(miniBarW, 1), 4, 0.5, 0.5, 'F');
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text(comp.methodology, 18, py + 4);
      doc.setTextColor(...SLATE);
      py += 10;
    }

    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('Sub-Catalyst Deployment Sequence', 14, py);
    doc.setFillColor(...TEAL);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    cat.sub_catalysts.forEach((sc: { name: string; estimated_monthly_volume: number; volume_unit: string; estimated_annual_saving_zar: number; deploy_prerequisite?: string }, i: number) => {
      doc.setFillColor(...NAVY);
      doc.circle(19, py - 1, 3, 'F');
      doc.setTextColor(...WHITE);
      doc.setFontSize(6);
      doc.text(`${i + 1}`, 17.5, py);
      doc.setTextColor(...SLATE);
      doc.setFontSize(8);
      doc.text(`${sc.name}`, 26, py);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`${sc.estimated_monthly_volume} ${sc.volume_unit}/month | R ${formatZAR(sc.estimated_annual_saving_zar)}/year`, 26, py + 4);
      if (sc.deploy_prerequisite) {
        doc.text(`Prerequisite: ${sc.deploy_prerequisite}`, 26, py + 8);
        py += 4;
      }
      py += 10;
    });

    pageFooter();
  }

  // ===== LAST PAGE - Deployment Roadmap =====
  doc.addPage();
  pageHeader('Deployment Roadmap');

  y = 28;
  const phases = [
    { label: 'Phase 1 - Quick Wins (Month 1-2)', desc: 'Deploy highest-impact catalysts with fastest payback', catalysts: scores.filter(c => c.deploy_order <= 2), color: TEAL },
    { label: 'Phase 2 - Core Expansion (Month 3-4)', desc: 'Extend AI coverage to operational processes', catalysts: scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4), color: NAVY },
    { label: 'Phase 3 - Full Intelligence (Month 5-6)', desc: 'Complete platform deployment with advanced analytics', catalysts: scores.filter(c => c.deploy_order >= 5), color: GOLD },
  ];

  for (const phase of phases) {
    if (phase.catalysts.length === 0) continue;
    doc.setFillColor(phase.color[0], phase.color[1], phase.color[2]);
    doc.roundedRect(14, y, pageW - 28, 8, 1, 1, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(9);
    doc.text(phase.label, 18, y + 5.5);
    y += 11;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(phase.desc, 18, y);
    y += 5;
    doc.setFontSize(8);
    for (const cat of phase.catalysts) {
      doc.setTextColor(...SLATE);
      doc.text(`\u2022 ${cat.catalyst_name}`, 22, y);
      doc.setTextColor(...NAVY);
      doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}/year`, 140, y);
      y += 5;
    }
    y += 6;
  }

  // Investment Summary Box
  y += 4;
  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, y, pageW - 28, 38, 3, 3, 'F');
  doc.setFillColor(...NAVY);
  doc.rect(14, y, 3, 38, 'F');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text('Investment Summary', 22, y + 9);
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`Platform Licence (${deploymentModel.toUpperCase()}):`, 22, y + 17);
  doc.text(`R ${formatZAR(annualLicence)}/year`, 120, y + 17);
  doc.text('Estimated Annual Savings:', 22, y + 23);
  doc.setTextColor(...TEAL);
  doc.text(`R ${formatZAR(totalSaving)}/year`, 120, y + 23);
  doc.setTextColor(...SLATE);
  doc.text('Net Annual Benefit:', 22, y + 29);
  doc.text(`R ${formatZAR(totalSaving - annualLicence)}/year`, 120, y + 29);
  doc.text('Payback Period:', 22, y + 35);
  doc.setTextColor(...NAVY);
  doc.text(`${paybackMonths} months`, 120, y + 35);

  y += 50;
  doc.setFillColor(...TEAL);
  doc.roundedRect(pageW / 2 - 55, y, 110, 14, 3, 3, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(10);
  doc.text('Ready to activate? Contact VantaX', pageW / 2, y + 9, { align: 'center' });
  pageFooter();

  // Trigger download
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(prospectName)}-business-case.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 2. TECHNICAL SIZING PDF
// ============================================================================

export async function generateTechnicalPDF(assessment: Assessment): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const results = assessment.results as AssessmentResults | null;
  const scores = results?.catalyst_scores ?? [];
  const sizing = results?.technical_sizing;
  const config = assessment.config as Record<string, unknown>;
  const snapshot = (results?.volume_snapshot ?? assessment.dataSnapshot ?? {}) as Record<string, unknown>;
  const prospectName = assessment.prospectName || 'Prospect';

  if (!sizing || scores.length === 0) {
    alert('No technical sizing data available.');
    return;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const deploymentModel = str(config.deployment_model, 'saas');
  const annualLicence = deploymentModel === 'saas'
    ? sizing.annual_licence_revenue
    : deploymentModel === 'hybrid' ? num(config.hybrid_licence_fee_pa) : num(config.onprem_licence_fee_pa);

  function techHeader(title: string) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...GOLD);
    doc.rect(0, 18, pageW, 1.2, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(12);
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.text(`${prospectName} | Internal`, pageW - 14, 12, { align: 'right' });
  }

  function techFooter() {
    doc.setFillColor(...NAVY);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setFontSize(6);
    doc.setTextColor(180, 200, 230);
    doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform', 14, pageH - 5);
    doc.text(`Generated ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`, pageW - 14, pageH - 5, { align: 'right' });
  }

  // ===== COVER =====
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, 80, pageW, 2, 'F');

  doc.setTextColor(...WHITE);
  doc.setFontSize(36);
  doc.text('ATHEON', pageW / 2, 45, { align: 'center' });
  doc.setFontSize(10);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 56, { align: 'center' });

  doc.setFontSize(18);
  doc.text('Technical Sizing Report', pageW / 2, 100, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text('Infrastructure, Capacity Planning & Cost Analysis', pageW / 2, 112, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text(prospectName, pageW / 2, 135, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`ERP: ${str(snapshot.erp_system, 'N/A')} | ${num(snapshot.months_of_data)} months data`, pageW / 2, 155, { align: 'center' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 163, { align: 'center' });
  doc.text('INTERNAL USE ONLY', pageW / 2, 180, { align: 'center' });

  doc.setFillColor(...GOLD);
  doc.rect(0, pageH - 14, pageW, 14, 'F');
  doc.setTextColor(...NAVY);
  doc.setFontSize(8);
  doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ===== PAGE 2 - ERP Data Profile =====
  doc.addPage();
  techHeader('ERP Data Profile');

  let y = 28;
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('Data Quality Score', 14, y);
  y += 4;
  const completeness = num(snapshot.data_completeness_pct);
  const gaugeW = 80;
  doc.setFillColor(230, 230, 230);
  doc.roundedRect(14, y, gaugeW, 6, 2, 2, 'F');
  const fillColor = completeness >= 80 ? GREEN : completeness >= 50 ? GOLD : RED;
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(14, y, gaugeW * (completeness / 100), 6, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(`${completeness}%`, gaugeW + 18, y + 4.5);
  doc.text(`ERP System: ${str(snapshot.erp_system, 'N/A')}`, 120, y + 4.5);
  y += 14;

  const sections: { title: string; rows: [string, string][] }[] = [
    { title: 'Transaction Volumes', rows: [
      ['Monthly Invoices', `${num(snapshot.monthly_invoices).toLocaleString()}`],
      ['Monthly Purchase Orders', `${num(snapshot.monthly_purchase_orders).toLocaleString()}`],
      ['Monthly Journal Entries', `${num(snapshot.monthly_journal_entries).toLocaleString()}`],
      ['Monthly Bank Transactions', `${num(snapshot.monthly_bank_transactions).toLocaleString()}`],
    ]},
    { title: 'Financial Position', rows: [
      ['Total AR Balance', `R ${formatZAR(num(snapshot.total_ar_balance))}`],
      ['Total AP Balance', `R ${formatZAR(num(snapshot.total_ap_balance))}`],
      ['Avg Invoice Value', `R ${formatZAR(num(snapshot.avg_invoice_value))}`],
      ['Revenue (12m)', `R ${formatZAR(num(snapshot.total_revenue_12m))}`],
      ['Spend (12m)', `R ${formatZAR(num(snapshot.total_spend_12m))}`],
    ]},
    { title: 'Organisation', rows: [
      ['Employees', `${num(snapshot.employee_count)}`],
      ['Active Customers', `${num(snapshot.active_customer_count)}`],
      ['Active Suppliers', `${num(snapshot.active_supplier_count)}`],
      ['Products', `${num(snapshot.product_count)}`],
      ['Inventory Value', `R ${formatZAR(num(snapshot.total_inventory_value))}`],
    ]},
  ];

  for (const section of sections) {
    doc.setFillColor(...TEAL);
    doc.roundedRect(14, y, pageW - 28, 7, 1, 1, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(8);
    doc.text(section.title, 18, y + 5);
    y += 9;
    doc.setFontSize(7.5);
    for (const [label, value] of section.rows) {
      if (Math.floor((y - 28) / 5) % 2 === 0) {
        doc.setFillColor(...LIGHT);
        doc.rect(14, y - 3, pageW - 28, 5, 'F');
      }
      doc.setTextColor(...SLATE);
      doc.text(label, 18, y);
      doc.setTextColor(...NAVY);
      doc.text(value, 120, y);
      y += 5;
    }
    y += 3;
  }
  techFooter();

  // ===== PAGE 3 - Infrastructure Sizing =====
  doc.addPage();
  techHeader('Infrastructure Sizing - SaaS (Cloudflare)');

  y = 28;
  const saasItems = [
    { svc: 'Workers (API)', vol: `${sizing.total_monthly_api_calls.toLocaleString()} calls/mo`, cost: sizing.cost_cf_workers },
    { svc: 'D1 Database', vol: `${sizing.total_db_size_gb} GB`, cost: sizing.cost_cf_d1 },
    { svc: 'Vectorize', vol: `${sizing.total_monthly_vector_queries.toLocaleString()} queries/mo`, cost: sizing.cost_cf_vectorize },
    { svc: 'Workers AI', vol: `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens/mo`, cost: sizing.cost_cf_workers_ai },
    { svc: 'R2 Storage', vol: `${sizing.total_storage_gb} GB`, cost: sizing.cost_cf_r2 },
    { svc: 'KV Cache', vol: `${sizing.total_kv_reads_monthly.toLocaleString()} reads/mo`, cost: sizing.cost_cf_kv },
  ];

  doc.setFillColor(...NAVY);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.text('Service', 18, y + 5.5);
  doc.text('Monthly Volume', 90, y + 5.5);
  doc.text('Cost (ZAR/mo)', 155, y + 5.5);
  y += 10;

  const maxCost = Math.max(...saasItems.map(i => i.cost), 1);
  saasItems.forEach((item, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(...LIGHT);
      doc.rect(14, y - 3.5, pageW - 28, 7, 'F');
    }
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(item.svc, 18, y);
    doc.text(item.vol, 90, y);
    doc.setTextColor(...NAVY);
    doc.text(`R ${formatZAR(item.cost)}`, 155, y);
    const barW = (item.cost / maxCost) * 25;
    doc.setFillColor(...TEAL);
    doc.roundedRect(180, y - 2.5, Math.max(barW, 1), 4, 0.5, 0.5, 'F');
    y += 7;
  });

  y += 2;
  doc.setFillColor(...NAVY);
  doc.rect(14, y - 3.5, pageW - 28, 8, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.text('TOTAL INFRASTRUCTURE COST', 18, y + 1);
  doc.text(`R ${formatZAR(sizing.total_infra_cost_pm_saas)}/month`, 155, y + 1);
  y += 14;

  // Revenue vs Cost
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('Revenue vs Cost Analysis', 14, y);
  y += 8;

  const revCostItems = [
    { label: 'Monthly Revenue', value: sizing.monthly_licence_revenue, color: GREEN },
    { label: 'Monthly Infrastructure Cost', value: sizing.total_infra_cost_pm_saas, color: RED },
    { label: 'Monthly Gross Margin', value: sizing.gross_margin_pm_saas, color: TEAL },
  ];
  const maxRev = Math.max(...revCostItems.map(i => Math.abs(i.value)), 1);
  for (const item of revCostItems) {
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(item.label, 18, y + 4);
    const barW = (Math.abs(item.value) / maxRev) * 80;
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(90, y, Math.max(barW, 1), 7, 1, 1, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(7);
    doc.text(`R ${formatZAR(item.value)}`, 92, y + 5);
    y += 10;
  }

  y += 5;
  const marginColor = sizing.gross_margin_pct_saas >= 70 ? GREEN : sizing.gross_margin_pct_saas >= 40 ? GOLD : RED;
  doc.setFillColor(marginColor[0], marginColor[1], marginColor[2]);
  doc.roundedRect(14, y, 50, 12, 3, 3, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(10);
  doc.text(`Gross Margin: ${sizing.gross_margin_pct_saas}%`, 18, y + 8);
  techFooter();

  // ===== PAGE 4 - Deployment Comparison =====
  doc.addPage();
  techHeader('Deployment Model Comparison');

  y = 28;
  doc.setFillColor(...NAVY);
  doc.rect(14, y, pageW - 28, 7, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.text('Metric', 18, y + 5);
  doc.text('SaaS', 100, y + 5);
  doc.text('On-Premise', 145, y + 5);
  y += 9;

  const compRows = [
    ['Monthly Infra Cost', `R ${formatZAR(sizing.total_infra_cost_pm_saas)}`, `R ${formatZAR(sizing.total_infra_cost_pm_onprem)}`],
    ['Monthly Revenue', `R ${formatZAR(sizing.monthly_licence_revenue)}`, `R ${formatZAR(num(config.onprem_licence_fee_pa) / 12)}`],
    ['Gross Margin/month', `R ${formatZAR(sizing.gross_margin_pm_saas)}`, `R ${formatZAR(sizing.gross_margin_pm_onprem)}`],
    ['Gross Margin %', `${sizing.gross_margin_pct_saas}%`, `${sizing.gross_margin_pct_onprem}%`],
    ['Annual Licence', `R ${formatZAR(sizing.annual_licence_revenue)}`, `R ${formatZAR(num(config.onprem_licence_fee_pa))}`],
  ];

  compRows.forEach(([label, saas, onprem], idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(...LIGHT);
      doc.rect(14, y - 3, pageW - 28, 6, 'F');
    }
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(label, 18, y);
    doc.text(saas, 100, y);
    doc.text(onprem, 145, y);
    y += 6;
  });

  // Recommendations
  y += 10;
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text('Recommendations', 14, y);
  doc.setFillColor(...GOLD);
  doc.rect(14, y + 2, 30, 0.5, 'F');
  y += 10;

  const recLicence = deploymentModel === 'saas' ? sizing.annual_licence_revenue : num(config.onprem_licence_fee_pa);
  const recItems = [
    `Recommended deployment model: ${deploymentModel.toUpperCase()} (${sizing.gross_margin_pct_saas >= sizing.gross_margin_pct_onprem ? 'higher margin' : 'client preference'})`,
    `Annual platform licence: R ${formatZAR(recLicence)}`,
    `Total estimated annual client savings: R ${formatZAR(totalSaving)}`,
    `Net annual benefit to client: R ${formatZAR(totalSaving - annualLicence)}`,
    `Payback period: ${annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0} months`,
    `${scores.length} AI catalysts identified across ${[...new Set(scores.map(c => c.domain))].length} operational domains`,
  ];

  doc.setFontSize(8);
  for (const item of recItems) {
    doc.setFillColor(...TEAL);
    doc.circle(17, y - 1, 1.5, 'F');
    doc.setTextColor(...SLATE);
    const lines = doc.splitTextToSize(item, pageW - 36);
    doc.text(lines, 22, y);
    y += lines.length * 4 + 3;
  }

  techFooter();

  // Download
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(prospectName)}-technical-sizing.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 3. VALUE ASSESSMENT PDF
// ============================================================================

export async function generateValueAssessmentPDF(
  assessment: Assessment,
  findings: ValueAssessmentFinding[],
  dataQuality: DataQualityRecord[],
  processTiming: ProcessTimingRecord[],
  valueSummary: ValueSummaryRecord | null,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const prospectName = assessment.prospectName || 'Prospect';
  const snapshot = (assessment.dataSnapshot ?? {}) as Record<string, unknown>;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  function vaHeader(title: string) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...TEAL);
    doc.rect(0, 18, pageW, 1.5, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(12);
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.text(`${prospectName} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  function vaFooter() {
    doc.setFillColor(...NAVY);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setFontSize(6);
    doc.setTextColor(180, 200, 230);
    doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform', 14, pageH - 5);
    doc.text(`Generated ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`, pageW - 14, pageH - 5, { align: 'right' });
  }

  // ===== COVER =====
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(0, 85, pageW, 3, 'F');

  doc.setTextColor(...WHITE);
  doc.setFontSize(36);
  doc.text('ATHEON', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(10);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 60, { align: 'center' });
  doc.setFillColor(...GOLD);
  doc.rect(pageW / 2 - 30, 66, 60, 0.8, 'F');

  doc.setFontSize(18);
  doc.text('Value Assessment Report', pageW / 2, 105, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text('Data-Driven Analysis of Financial Impact & Recovery Opportunities', pageW / 2, 115, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text(prospectName, pageW / 2, 140, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`ERP: ${str(snapshot.erp_system, 'N/A')} | Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 160, { align: 'center' });
  doc.text('CONFIDENTIAL - For Authorised Recipients Only', pageW / 2, 175, { align: 'center' });

  doc.setFillColor(...GOLD);
  doc.rect(0, pageH - 14, pageW, 14, 'F');
  doc.setTextColor(...NAVY);
  doc.setFontSize(8);
  doc.text('VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ===== VALUE SUMMARY KPIs =====
  if (valueSummary) {
    doc.addPage();
    vaHeader('Value Assessment Summary');

    const kpis = [
      { label: 'Total Issues Found', value: valueSummary.total_findings.toString(), sub: `${valueSummary.total_critical_findings} critical`, color: NAVY },
      { label: 'Immediate Recovery', value: formatRk(valueSummary.total_immediate_value), sub: 'One-time cleanup value', color: GREEN },
      { label: 'Ongoing Monthly Value', value: formatRk(valueSummary.total_ongoing_monthly_value), sub: `${formatRk(valueSummary.total_ongoing_annual_value)}/year`, color: TEAL },
      { label: 'Payback Period', value: formatDays(valueSummary.payback_days, { long: true }), sub: `Outcome fee: ${formatRk(valueSummary.outcome_based_monthly_fee)}/mo`, color: GOLD },
    ];

    const kw = (pageW - 25) / 2;
    kpis.forEach((kpi, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 10 + col * (kw + 5);
      const ky = 28 + row * 28;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x, ky, kw, 23, 2, 2, 'F');
      doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
      doc.rect(x, ky, 2, 23, 'F');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(kpi.label, x + 6, ky + 7);
      doc.setFontSize(16);
      doc.setTextColor(...SLATE);
      doc.text(kpi.value, x + 6, ky + 17);
      doc.setFontSize(6);
      doc.setTextColor(120, 120, 120);
      doc.text(kpi.sub, x + 6, ky + 21);
    });

    let y = 90;

    if (valueSummary.executive_narrative) {
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text('Executive Summary', 14, y);
      doc.setFillColor(...TEAL);
      doc.rect(14, y + 2, 25, 0.5, 'F');
      y += 8;
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      const nLines = doc.splitTextToSize(valueSummary.executive_narrative, pageW - 28);
      doc.text(nLines, 14, y);
      y += nLines.length * 3.5 + 6;
    }

    if (valueSummary.value_by_domain) {
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text('Value by Domain', 14, y);
      doc.setFillColor(...TEAL);
      doc.rect(14, y + 2, 25, 0.5, 'F');
      y += 8;

      const domainData = Object.entries(valueSummary.value_by_domain)
        .map(([domain, val]) => ({
          domain,
          immediate: val.immediate || 0,
          ongoing: (val.ongoing || 0) * 12,
        }))
        .sort((a, b) => (b.immediate + b.ongoing) - (a.immediate + a.ongoing));

      const maxDomainValue = Math.max(...domainData.map(d => d.immediate + d.ongoing), 1);
      const domainBarMax = pageW - 80;

      for (const d of domainData) {
        doc.setFontSize(8);
        doc.setTextColor(...SLATE);
        doc.text(d.domain.charAt(0).toUpperCase() + d.domain.slice(1), 18, y + 4);
        const immW = (d.immediate / maxDomainValue) * domainBarMax;
        const ongW = (d.ongoing / maxDomainValue) * domainBarMax;
        doc.setFillColor(...GREEN);
        doc.roundedRect(60, y, Math.max(immW, 1), 6, 1, 1, 'F');
        doc.setFillColor(...TEAL);
        doc.roundedRect(60 + immW, y, Math.max(ongW, 1), 6, 1, 1, 'F');
        doc.setFontSize(6);
        doc.setTextColor(...NAVY);
        doc.text(formatRk(d.immediate + d.ongoing), 60 + immW + ongW + 3, y + 4);
        y += 9;
      }

      doc.setFontSize(6);
      doc.setTextColor(120, 120, 120);
      doc.setFillColor(...GREEN);
      doc.rect(18, y, 6, 3, 'F');
      doc.text('Immediate', 26, y + 2.5);
      doc.setFillColor(...TEAL);
      doc.rect(55, y, 6, 3, 'F');
      doc.text('Ongoing (Annual)', 63, y + 2.5);
    }

    vaFooter();
  }

  // ===== FINDINGS =====
  if (findings.length > 0) {
    doc.addPage();
    vaHeader('Key Findings');

    let y = 28;
    doc.setFillColor(...NAVY);
    doc.rect(14, y, pageW - 28, 8, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(7);
    doc.text('Severity', 18, y + 5.5);
    doc.text('Finding', 42, y + 5.5);
    doc.text('Domain', 120, y + 5.5);
    doc.text('Impact', 150, y + 5.5);
    doc.text('Records', 178, y + 5.5);
    y += 10;

    const sortedFindings = [...findings].sort((a, b) => b.financial_impact - a.financial_impact).slice(0, 25);
    for (const f of sortedFindings) {
      if (y > pageH - 25) {
        vaFooter();
        doc.addPage();
        vaHeader('Key Findings (continued)');
        y = 28;
      }

      const sevColor = f.severity === 'critical' ? RED : f.severity === 'high' ? GOLD : TEAL;
      doc.setFillColor(sevColor[0], sevColor[1], sevColor[2]);
      doc.roundedRect(18, y - 3, 18, 5, 1, 1, 'F');
      doc.setTextColor(...WHITE);
      doc.setFontSize(6);
      doc.text(f.severity.toUpperCase(), 20, y);

      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      const titleLines = doc.splitTextToSize(f.title, 74);
      doc.text(titleLines[0], 42, y);
      doc.text(f.domain, 120, y);
      doc.setTextColor(...GREEN);
      doc.text(formatRk(f.financial_impact), 150, y);
      doc.setTextColor(...SLATE);
      doc.text(`${f.affected_records}`, 178, y);
      y += titleLines.length > 1 ? 9 : 7;
    }

    if (findings.length > 25) {
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`... and ${findings.length - 25} more findings. See Excel report for complete list.`, 18, y + 3);
    }

    vaFooter();
  }

  // ===== DATA QUALITY =====
  if (dataQuality.length > 0) {
    doc.addPage();
    vaHeader('Data Quality Report Card');

    let y = 28;
    for (const dq of dataQuality) {
      if (y > pageH - 35) {
        vaFooter();
        doc.addPage();
        vaHeader('Data Quality Report Card (continued)');
        y = 28;
      }

      const scoreColor = dq.overall_quality_score >= 80 ? GREEN : dq.overall_quality_score >= 60 ? GOLD : RED;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(14, y, pageW - 28, 22, 2, 2, 'F');
      doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
      doc.rect(14, y, 2, 22, 'F');

      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      const tableName = dq.table_name.replace('erp_', '').replace(/_/g, ' ');
      doc.text(tableName.charAt(0).toUpperCase() + tableName.slice(1), 20, y + 7);

      doc.setFontSize(14);
      doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
      doc.text(`${Math.round(dq.overall_quality_score)}%`, pageW - 30, y + 10);

      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      doc.text(`${dq.total_records.toLocaleString()} records | ${dq.completeness_pct.toFixed(0)}% complete | ${dq.duplicate_records} duplicates | ${dq.orphan_records} orphans | ${dq.stale_records} stale | ${dq.referential_issues} ref issues`, 20, y + 15);

      const barY = y + 17;
      doc.setFillColor(230, 230, 230);
      doc.roundedRect(20, barY, pageW - 50, 3, 1, 1, 'F');
      doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
      doc.roundedRect(20, barY, (pageW - 50) * (dq.overall_quality_score / 100), 3, 1, 1, 'F');

      y += 27;
    }

    vaFooter();
  }

  // ===== PROCESS TIMING =====
  if (processTiming.length > 0) {
    doc.addPage();
    vaHeader('Process Timing Analysis');

    let y = 28;
    for (const t of processTiming) {
      if (y > pageH - 35) {
        vaFooter();
        doc.addPage();
        vaHeader('Process Timing Analysis (continued)');
        y = 28;
      }

      const overBenchmark = t.avg_cycle_time_days > t.benchmark_cycle_time_days;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(14, y, pageW - 28, 24, 2, 2, 'F');
      doc.setFillColor(overBenchmark ? RED[0] : GREEN[0], overBenchmark ? RED[1] : GREEN[1], overBenchmark ? RED[2] : GREEN[2]);
      doc.rect(14, y, 2, 24, 'F');

      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      doc.text(t.process_name, 20, y + 7);

      if (overBenchmark) {
        doc.setFillColor(...RED);
        doc.roundedRect(pageW - 50, y + 2, 30, 5, 1, 1, 'F');
        doc.setTextColor(...WHITE);
        doc.setFontSize(6);
        doc.text('OVER BENCHMARK', pageW - 48, y + 5.5);
      }

      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      doc.text(`Avg: ${formatDays(t.avg_cycle_time_days, { long: true, decimals: 1 })} | P90: ${formatDays(t.p90_cycle_time_days, { long: true, decimals: 1 })} | Benchmark: ${formatDays(t.benchmark_cycle_time_days, { long: true })}`, 20, y + 14);
      doc.text(`${t.records_analysed} records | ${t.records_exceeding_benchmark} over benchmark`, 20, y + 19);
      if (t.financial_impact_of_delay > 0) {
        doc.setTextColor(...RED);
        doc.text(`Impact: ${formatRk(t.financial_impact_of_delay)}`, 130, y + 19);
      }
      if (t.bottleneck_step) {
        doc.setTextColor(120, 120, 120);
        doc.text(`Bottleneck: ${t.bottleneck_step} (${formatDays(t.bottleneck_avg_days, { long: true, decimals: 1 })})`, 20, y + 23);
      }

      y += 28;
    }

    vaFooter();
  }

  // ===== PRICING PROPOSAL =====
  if (valueSummary) {
    doc.addPage();
    vaHeader('Outcome-Based Pricing Proposal');

    let y = 28;
    const fee = (valueSummary.outcome_based_fee_pct || 20) / 100;
    const monthlyOngoing = valueSummary.total_ongoing_monthly_value;
    const immediate = valueSummary.total_immediate_value;

    doc.setFillColor(...NAVY);
    doc.rect(14, y, pageW - 28, 8, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(8);
    doc.text('Metric', 18, y + 5.5);
    doc.text('Year 1', 90, y + 5.5);
    doc.text('Year 2', 120, y + 5.5);
    doc.text('Year 3', 150, y + 5.5);
    y += 10;

    const y1Value = immediate + monthlyOngoing * 12;
    const y2Value = monthlyOngoing * 12 * 1.1;
    const y3Value = monthlyOngoing * 12 * 1.2;

    const pricingRows = [
      ['Value Delivered', formatRk(y1Value), formatRk(y2Value), formatRk(y3Value)],
      ['Atheon Fee', formatRk(monthlyOngoing * 12 * fee), formatRk(monthlyOngoing * 12 * 1.1 * fee), formatRk(monthlyOngoing * 12 * 1.2 * fee)],
      ['Monthly Fee', formatRk(monthlyOngoing * fee), formatRk(monthlyOngoing * 1.1 * fee), formatRk(monthlyOngoing * 1.2 * fee)],
      ['Net Value to Client', formatRk(y1Value - monthlyOngoing * 12 * fee), formatRk(y2Value * (1 - fee)), formatRk(y3Value * (1 - fee))],
    ];

    pricingRows.forEach(([label, v1, v2, v3], idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(...LIGHT);
        doc.rect(14, y - 3, pageW - 28, 6, 'F');
      }
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      doc.text(label, 18, y);
      doc.text(v1, 90, y);
      doc.text(v2, 120, y);
      doc.text(v3, 150, y);
      y += 6;
    });

    y += 10;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(14, y, pageW - 28, 22, 3, 3, 'F');
    doc.setFillColor(...NAVY);
    doc.rect(14, y, 3, 22, 'F');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('Pricing Model', 22, y + 8);
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(`Outcome-based fee: ${(fee * 100).toFixed(0)}% of value delivered`, 22, y + 14);
    doc.text(`Payback period: ${formatDays(valueSummary.payback_days, { long: true })}`, 22, y + 19);

    vaFooter();
  }

  // Download
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(prospectName)}-value-assessment.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 4. EXCEL FINANCIAL MODEL
// ============================================================================

export async function generateExcelReport(assessment: Assessment): Promise<void> {
  const XLSX = await import('xlsx');
  const results = assessment.results as AssessmentResults | null;
  const scores = results?.catalyst_scores ?? [];
  const sizing = results?.technical_sizing;
  const config = assessment.config as Record<string, unknown>;
  const snapshot = (results?.volume_snapshot ?? assessment.dataSnapshot ?? {}) as Record<string, unknown>;
  const prospectName = assessment.prospectName || 'Prospect';

  if (scores.length === 0) {
    alert('No catalyst scores available to generate report.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const deploymentModel = str(config.deployment_model, 'saas');
  const annualLicence = sizing
    ? (deploymentModel === 'saas'
      ? sizing.annual_licence_revenue
      : deploymentModel === 'hybrid' ? num(config.hybrid_licence_fee_pa) : num(config.onprem_licence_fee_pa))
    : 0;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  // Sheet 1 - Executive Summary
  const summaryData: (string | number)[][] = [
    ['ATHEON INTELLIGENCE PLATFORM - AI Catalyst Assessment Model'],
    [`Prepared for: ${prospectName}`],
    [''],
    ['KEY METRICS', '', 'VALUE'],
    ['Total Estimated Annual Savings', '', totalSaving],
    ['AI Catalysts Identified', '', scores.length],
    ['Recommended First Catalyst', '', scores[0]?.catalyst_name || 'N/A'],
    ['Platform Licence (Annual)', '', annualLicence],
    ['Net Annual Benefit', '', totalSaving - annualLicence],
    ['Payback Period', '', `${paybackMonths} months`],
    ['Return on Investment', '', `${roi}%`],
    ['Deployment Model', '', deploymentModel.toUpperCase()],
    ['Contract Duration', '', `${num(config.contract_years, 3)} years`],
    ['Target Users', '', num(config.target_users, 50)],
    [''],
    ['ERP DATA PROFILE'],
    ['ERP System', '', str(snapshot.erp_system, 'N/A')],
    ['Months of Data', '', num(snapshot.months_of_data)],
    ['Data Completeness', '', `${num(snapshot.data_completeness_pct)}%`],
    ['Monthly Invoices', '', num(snapshot.monthly_invoices)],
    ['Monthly POs', '', num(snapshot.monthly_purchase_orders)],
    ['Employees', '', num(snapshot.employee_count)],
    ['Active Customers', '', num(snapshot.active_customer_count)],
    ['Active Suppliers', '', num(snapshot.active_supplier_count)],
    ['Total Revenue (12m)', '', num(snapshot.total_revenue_12m)],
    ['Total Spend (12m)', '', num(snapshot.total_spend_12m)],
    [''],
    ['DEPLOYMENT ROADMAP'],
    ['Phase 1 (Month 1-2)', '', scores.filter(c => c.deploy_order <= 2).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 2 (Month 3-4)', '', scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 3 (Month 5-6)', '', scores.filter(c => c.deploy_order >= 5).map(c => c.catalyst_name).join(', ') || 'N/A'],
    [''],
    ['VantaX (Pty) Ltd | Powered by Atheon Intelligence Platform'],
    [`Date: ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 35 }, { wch: 5 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary');

  // Sheet 2 - Catalyst Savings
  const savingsData: (string | number)[][] = [
    ['CATALYST SAVINGS MODEL'],
    [''],
    ['Priority', 'Catalyst', 'Domain', 'Sub-Catalyst', 'Volume/Month', 'Unit', 'Est. Annual Saving (ZAR)', 'Confidence', 'Deploy Order'],
  ];
  let grandTotal = 0;
  for (const cat of scores) {
    let catTotal = 0;
    for (const sc of cat.sub_catalysts) {
      savingsData.push([
        cat.priority, cat.catalyst_name, cat.domain, sc.name,
        sc.estimated_monthly_volume, sc.volume_unit,
        sc.estimated_annual_saving_zar, cat.confidence, cat.deploy_order,
      ]);
      catTotal += sc.estimated_annual_saving_zar;
    }
    savingsData.push(['', `${cat.catalyst_name} SUBTOTAL`, '', '', '', '', catTotal, '', '']);
    grandTotal += catTotal;
  }
  savingsData.push(['', '', '', '', '', '', '', '', '']);
  savingsData.push(['', 'GRAND TOTAL', '', '', '', '', grandTotal, '', '']);
  const savingsSheet = XLSX.utils.aoa_to_sheet(savingsData);
  savingsSheet['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 15 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, savingsSheet, 'Catalyst Savings');

  // Sheet 3 - Deep Dives
  const deepDiveData: (string | number)[][] = [
    ['CATALYST DEEP DIVES'],
    [''],
  ];
  for (const cat of scores) {
    deepDiveData.push([`${cat.catalyst_name} (${cat.domain})`, '', '', '', '']);
    deepDiveData.push(['Priority', cat.priority, 'Confidence', cat.confidence, '']);
    deepDiveData.push(['Est. Annual Saving', cat.estimated_annual_saving_zar, 'Deploy Order', cat.deploy_order, '']);
    deepDiveData.push(['']);
    deepDiveData.push(['Data Insights:']);
    for (const insight of cat.data_insights) {
      deepDiveData.push([`  - ${insight}`]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Savings Components:', 'Label', 'Amount (ZAR)', 'Methodology']);
    for (const comp of cat.saving_components) {
      deepDiveData.push(['', comp.label, comp.amount_zar, comp.methodology]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Sub-Catalysts:', 'Name', 'Volume/Month', 'Unit', 'Annual Saving (ZAR)']);
    for (const sc of cat.sub_catalysts) {
      deepDiveData.push(['', sc.name, sc.estimated_monthly_volume, sc.volume_unit, sc.estimated_annual_saving_zar]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['']);
  }
  const deepDiveSheet = XLSX.utils.aoa_to_sheet(deepDiveData);
  deepDiveSheet['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, deepDiveSheet, 'Catalyst Deep Dives');

  // Sheet 4 - Volume Data
  const volData: (string | number)[][] = [
    ['ERP VOLUME DATA SNAPSHOT'],
    [''],
    ['Category', 'Metric', 'Value', 'Description'],
    ['Transaction', 'Monthly Invoices', num(snapshot.monthly_invoices), 'Average invoices processed per month'],
    ['Transaction', 'Monthly Purchase Orders', num(snapshot.monthly_purchase_orders), 'Average POs per month'],
    ['Transaction', 'Monthly Journal Entries', num(snapshot.monthly_journal_entries), 'Average journal entries per month'],
    ['Transaction', 'Monthly Bank Transactions', num(snapshot.monthly_bank_transactions), 'Average bank transactions per month'],
    ['Financial', 'Total AR Balance', num(snapshot.total_ar_balance), 'Accounts receivable outstanding'],
    ['Financial', 'Total AP Balance', num(snapshot.total_ap_balance), 'Accounts payable outstanding'],
    ['Financial', 'Revenue (12m)', num(snapshot.total_revenue_12m), 'Total revenue last 12 months (ZAR)'],
    ['Financial', 'Spend (12m)', num(snapshot.total_spend_12m), 'Total spend last 12 months (ZAR)'],
    ['Organisation', 'Employees', num(snapshot.employee_count), 'Active employee count'],
    ['Organisation', 'Active Customers', num(snapshot.active_customer_count), 'Unique active customers'],
    ['Organisation', 'Active Suppliers', num(snapshot.active_supplier_count), 'Unique active suppliers'],
    ['Inventory', 'Products', num(snapshot.product_count), 'Active product SKUs'],
    ['Inventory', 'Inventory Value', num(snapshot.total_inventory_value), 'Total inventory on hand (ZAR)'],
    ['Data', 'Months of Data', num(snapshot.months_of_data), 'Historical data depth'],
    ['Data', 'Data Completeness', num(snapshot.data_completeness_pct), 'Data quality score (%)'],
    ['Data', 'ERP System', str(snapshot.erp_system, 'N/A'), 'Source ERP platform'],
  ];
  const volSheet = XLSX.utils.aoa_to_sheet(volData);
  volSheet['!cols'] = [{ wch: 15 }, { wch: 28 }, { wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, volSheet, 'Volume Data');

  // Sheet 5 - Infrastructure
  if (sizing) {
    const infraData: (string | number)[][] = [
      ['INFRASTRUCTURE COST MODEL'],
      [''],
      ['Service Component', 'Monthly Volume', 'SaaS Cost (ZAR/mo)'],
      ['Workers (API Calls)', `${sizing.total_monthly_api_calls.toLocaleString()} calls`, sizing.cost_cf_workers],
      ['D1 Database', `${sizing.total_db_size_gb} GB`, sizing.cost_cf_d1],
      ['Vectorize (Embeddings)', `${sizing.total_monthly_vector_queries.toLocaleString()} queries`, sizing.cost_cf_vectorize],
      ['Workers AI (LLM)', `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens`, sizing.cost_cf_workers_ai],
      ['R2 Object Storage', `${sizing.total_storage_gb} GB`, sizing.cost_cf_r2],
      ['KV Cache', `${sizing.total_kv_reads_monthly.toLocaleString()} reads`, sizing.cost_cf_kv],
      [''],
      ['TOTALS'],
      ['Total Infra Cost/month', '', sizing.total_infra_cost_pm_saas],
      ['Monthly Revenue', '', sizing.monthly_licence_revenue],
      ['Gross Margin/month', '', sizing.gross_margin_pm_saas],
      ['Gross Margin %', '', sizing.gross_margin_pct_saas],
      ['Annual Licence Revenue', '', sizing.annual_licence_revenue],
    ];
    const infraSheet = XLSX.utils.aoa_to_sheet(infraData);
    infraSheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infraSheet, 'Infrastructure Costs');
  }

  // Sheet 6 - Assumptions
  const varsData: (string | number)[][] = [
    ['ASSESSMENT ASSUMPTIONS & CONFIGURATION'],
    [''],
    ['Parameter', 'Value', 'Unit', 'Description'],
    ['SaaS Price/User/Month', num(config.saas_price_per_user_pm), 'ZAR', 'Per-user SaaS subscription price'],
    ['On-Prem Licence/Year', num(config.onprem_licence_fee_pa), 'ZAR', 'Annual on-premise licence fee'],
    ['Hybrid Licence/Year', num(config.hybrid_licence_fee_pa), 'ZAR', 'Annual hybrid licence fee'],
    ['AR Recovery Rate', num(config.ar_savings_pct), '%', 'Expected AR balance recovery improvement'],
    ['AP Processing Savings', num(config.ap_savings_pct), '%', 'AP automation efficiency gain'],
    ['Invoice Recon Savings', num(config.invoice_recon_savings_pct), '%', 'Reconciliation error reduction'],
    ['Procurement Savings', num(config.procurement_savings_pct), '%', 'Supplier scoring and spend optimization'],
    ['Workforce Savings', num(config.workforce_savings_pct), '%', 'Payroll scheduling optimization'],
    ['Supply Chain Savings', num(config.supply_chain_savings_pct), '%', 'Inventory and demand optimization'],
    ['Compliance Avoidance', num(config.compliance_fine_avoidance_pct), '%', 'Regulatory fine avoidance (% of revenue)'],
    ['Maintenance Savings', num(config.maintenance_savings_pct), '%', 'Predictive maintenance improvement'],
    [''],
    ['GENERAL'],
    ['Deployment Model', str(config.deployment_model, 'saas'), '', 'Selected deployment architecture'],
    ['Currency', str(config.currency, 'ZAR'), '', 'Display currency'],
    ['Target Users', num(config.target_users, 50), '', 'Number of licensed users'],
    ['Contract Duration', num(config.contract_years, 3), 'years', 'Contract term length'],
  ];
  const varsSheet = XLSX.utils.aoa_to_sheet(varsData);
  varsSheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, varsSheet, 'Assumptions');

  // Sheet 7 - 3-Year Projection
  const projData: (string | number)[][] = [
    ['3-YEAR FINANCIAL PROJECTION'],
    [''],
    ['Metric', 'Year 1', 'Year 2', 'Year 3', 'Total'],
    ['Estimated Savings', totalSaving, Math.round(totalSaving * 1.1), Math.round(totalSaving * 1.2), Math.round(totalSaving * 3.3)],
    ['Platform Licence Cost', annualLicence, Math.round(annualLicence * 1.03), Math.round(annualLicence * 1.06), Math.round(annualLicence * 3.09)],
    ['Net Benefit', totalSaving - annualLicence, Math.round(totalSaving * 1.1 - annualLicence * 1.03), Math.round(totalSaving * 1.2 - annualLicence * 1.06), Math.round(totalSaving * 3.3 - annualLicence * 3.09)],
    ['Cumulative Benefit', totalSaving - annualLicence, Math.round(totalSaving * 2.1 - annualLicence * 2.03), Math.round(totalSaving * 3.3 - annualLicence * 3.09), ''],
  ];
  const projSheet = XLSX.utils.aoa_to_sheet(projData);
  projSheet['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, projSheet, 'Financial Projection');

  // Write and download
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(prospectName)}-financial-model.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
