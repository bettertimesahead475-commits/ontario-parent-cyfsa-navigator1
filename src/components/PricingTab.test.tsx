// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import PricingTab from './PricingTab';

// Mock wouter
vi.mock('wouter', () => ({
  useLocation: () => ['/pricing', vi.fn()],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('PricingTab Branding & Payment Instructions', () => {
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
});
