// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PricingTab from './PricingTab';

// Mock wouter
const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/pricing', mockSetLocation],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Mock Firebase
vi.mock('../utils/firebase', () => ({
  auth: { currentUser: null },
  signInMinimal: vi.fn(async () => ({ email: 'testparent@example.com' })),
}));

describe('PricingTab Branding & Payment Instructions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            prices: {
              Basic: 19.99,
              Premium: 49.99,
              Pro: 149,
              Community5: 2000,
              Community10: 3500,
              Community25: 7500,
            },
          }),
      })
    ) as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('displays chris@cyfsanavigator.com for customer-facing e-Transfer and organizational intake', () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} />);

    // Organizational intake email link
    const intakeLinks = screen.getAllByRole('link', { name: /chris@cyfsanavigator\.com/i });
    expect(intakeLinks.length).toBeGreaterThan(0);
    expect(intakeLinks[0].getAttribute('href')).toBe('mailto:chris@cyfsanavigator.com');

    // Activator card guidance
    expect(
      screen.getByText(/If you already sent an Interac e-Transfer to/i)
    ).toBeDefined();

    // Verify all occurrences of the branded payment email
    const emailElements = screen.getAllByText((content) => content.includes('chris@cyfsanavigator.com'));
    expect(emailElements.length).toBeGreaterThanOrEqual(2);
  });

  it('renders all four primary plans with accurate prices, quotas, and billing types', () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} />);

    // Free / Self-Represented
    expect(screen.getAllByText(/Free \/ Self-Represented/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 Free Quick Document Review/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Free Forever • No card needed/i)).toBeDefined();

    // Analyzer Basic
    expect(screen.getAllByText(/Analyzer Basic/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 Quick Document Reviews included/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/One-Time Payment • No Subscription/i).length).toBe(2);

    // Analyzer Premium
    expect(screen.getAllByText(/Analyzer Premium/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 Forensic Dual-Pass or Quick Analyses/i).length).toBeGreaterThan(0);

    // Individual Case Access
    expect(screen.getAllByText(/Individual Case Access/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 Forensic Analyses per monthly billing cycle/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Monthly Access • Standard Entitlement Rules/i)).toBeDefined();
  });

  it('renders community and organizational sponsorship tiers with verified limits', () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} />);

    expect(screen.getAllByText(/Community.*Legal Clinic Sponsorship/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Community 5/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 sponsored families/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Community 10/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 sponsored families/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Community 25/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/25 sponsored families/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Regional \/ Enterprise/i).length).toBeGreaterThan(0);
  });

  it('explains what happens when document analysis allocation is exhausted', () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} />);

    expect(screen.getAllByText(/How Analysis Allocations Work/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/2\. Your work is never locked/i)).toBeDefined();
    expect(screen.getByText(/3\. Adding more analyses/i)).toBeDefined();
  });

  it('opens checkout modal when clicking Get Access', async () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} userEmail="parent@example.com" />);

    const getAccessBtn = screen.getByRole('button', { name: /Get Access \(\$19\.99\)/i });
    fireEvent.click(getAccessBtn);

    // Modal appears
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Interac e-Transfer Checkout/i)).toBeDefined();
    expect(screen.getByText(/Create Payment Instructions/i)).toBeDefined();
  });

  it('accurately describes automated payment notification and activation process without obsolete manual approval claims', () => {
    render(<PricingTab currentTier="Basic" onChangeTier={vi.fn()} />);

    // Trust badge description
    expect(screen.getAllByText(/Our automated system monitors incoming transfer notifications for your unique payment reference/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/matched manually against your reference number before any access code is issued/i)).toBeNull();
  });
});
