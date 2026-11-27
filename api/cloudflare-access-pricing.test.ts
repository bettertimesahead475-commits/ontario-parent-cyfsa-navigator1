import { describe, expect, it } from 'vitest';
import { onRequestGet, TIER_PRICES } from '../functions/api/access-pricing';

describe('Cloudflare Access Pricing Endpoint (/api/access-pricing)', () => {
  it('returns valid product catalogue with canonical prices', async () => {
    const response = await onRequestGet();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.prices).toEqual(TIER_PRICES);
    expect(json.products.analyzer_products.basic.price).toBe(19.99);
    expect(json.products.analyzer_products.premium.price).toBe(49.99);
    expect(json.products.case_access.individual.price).toBe(149);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
