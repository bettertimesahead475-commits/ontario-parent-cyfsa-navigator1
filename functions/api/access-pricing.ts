/**
 * Cloudflare Pages Functions - Authoritative Product & Pricing API.
 *
 * GET /api/access-pricing
 * Returns verified tier prices, product descriptions, and feature entitlements.
 */

const DEFAULT_HEADERS = {
  'Cache-Control': 'public, max-age=3600',
  'X-Content-Type-Options': 'nosniff',
};

export const TIER_PRICES: Record<string, number> = {
  Basic: 19.99,
  AnalyzerBasic: 19.99,
  Premium: 49.99,
  AnalyzerPremium: 49.99,
  Pro: 149,
  Community5: 2000,
  Community10: 3500,
  Community25: 7500,
};

export const onRequestGet = async (): Promise<Response> => {
  return Response.json(
    {
      prices: TIER_PRICES,
      products: {
        analyzer_products: {
          basic: {
            id: 'Basic',
            name: 'Document Analyzer — Basic',
            price: 19.99,
            currency: 'CAD',
            interval: 'one-time',
            scope: 'analyzer_only',
            description: 'Document Analyzer access only. Up to 3 Quick Document Reviews, on-screen timeline, and core red-flag audit.',
            quickReviewsLimit: 3,
            features: [
              '3 Quick Document Reviews included (Core Audit)',
              'Contemporaneous fact vs allegation extraction',
              'Statutory CYFSA section reference mapping',
              'On-screen document timeline breakdown',
            ],
            restrictions: [
              'No Case Workspace or evidence vault access',
              'No Forensic In-Depth Dual-Pass scanning',
              'No court template builders or lawyer PDF exports',
            ],
          },
          premium: {
            id: 'Premium',
            name: 'Document Analyzer — Premium',
            price: 49.99,
            currency: 'CAD',
            interval: 'one-time',
            scope: 'analyzer_only',
            forensicLimit: 5,
            description: 'Premium Document Analyzer access with 5 Forensic In-Depth Dual-Pass analyses.',
            features: [
              '5 Forensic In-Depth Dual-Pass Analyses included',
              'Standard Quick Document Reviews included',
              'Cross-examination vulnerability scanner',
              'Evidentiary Weight & Hearsay objection audit',
              'Priority document analysis processing',
            ],
            restrictions: [
              'No Case Workspace or evidence vault access',
              'No ongoing case management or court filing workflows',
            ],
          },
        },
        case_access: {
          individual: {
            id: 'Pro',
            name: 'Individual / Family — CYFSA Case Access',
            price: 149,
            currency: 'CAD',
            interval: 'month',
            scope: 'full_platform',
            forensicLimit: 5,
            description: 'Full CYFSA case management, preparation, and evidence platform access. Includes 5 Forensic In-Depth Analyses per monthly billing cycle.',
            features: [
              'Full premium case platform access',
              'Case Workspace & Evidence Management Vault',
              '5 Forensic In-Depth Analyses per monthly billing cycle',
              'All 5 Ontario Court Template Builders Unlocked',
              'Cross-Document Matter Timelines & Chronologies',
              'Professional Lawyer PDF Export Desk',
              'Multi-File RAG Chat & Forensic Workspace',
            ],
          },
        },
        community: {
          community5: {
            id: 'Community5',
            name: 'Community 5 Sponsored Case Access',
            price: 2000,
            currency: 'CAD',
            interval: 'month',
            scope: 'sponsored_case_access',
            sponsoredFamilies: 5,
            description: 'Sponsors full CYFSA Case Access for up to 5 participating families.',
          },
          community10: {
            id: 'Community10',
            name: 'Community 10 Sponsored Case Access',
            price: 3500,
            currency: 'CAD',
            interval: 'month',
            scope: 'sponsored_case_access',
            sponsoredFamilies: 10,
            description: 'Sponsors full CYFSA Case Access for up to 10 participating families.',
          },
          community25: {
            id: 'Community25',
            name: 'Community 25 Sponsored Case Access',
            price: 7500,
            currency: 'CAD',
            interval: 'month',
            scope: 'sponsored_case_access',
            sponsoredFamilies: 25,
            description: 'Sponsors full CYFSA Case Access for up to 25 participating families.',
          },
        },
      },
      tiers: {
        free: {
          name: 'Free / Self-Represented',
          price: 0,
          interval: 'forever',
          description: 'Free on-screen document understanding. No premium report download/export/print unless included in paid access.',
          features: [
            'Free on-screen document understanding',
            'CYFSA Statutory Search Guides',
            'Ontario Family Court Process Checklists',
            'On-Screen Document Understanding & Timelines',
          ],
          restrictions: [
            'No premium report download/export/print unless included in paid access',
            '1 Free Quick Document Review',
          ],
        },
      },
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
