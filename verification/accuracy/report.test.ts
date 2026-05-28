import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

const ASSESSMENT_ID = 'va-demo-vantax';

/**
 * The value-assessment PDF is a billing artefact. globalSetup has reseeded (which
 * regenerates the report); here we confirm the key is persisted and the endpoint
 * serves a real PDF.
 */
describe('value-assessment report availability', () => {
  const client = new ApiClient();
  beforeAll(async () => { await client.login(); });

  it('business_report_key is populated after seed', async () => {
    const a = await client.getAssessment(ASSESSMENT_ID);
    expect(a.businessReportKey).toBeTruthy();
  });

  it('GET /report/business serves a PDF (HTTP 200, %PDF body)', async () => {
    const r = await client.getBusinessReport(ASSESSMENT_ID);
    expect(r.status).toBe(200);
    // PDF magic is the 4 bytes "%PDF" followed by a version ("%PDF-1.7").
    expect(r.head.startsWith('%PDF')).toBe(true);
    expect(r.contentType).toContain('application/pdf');
  });
});
