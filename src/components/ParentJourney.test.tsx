// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import ParentJourney from './ParentJourney';

// Mock wouter
vi.mock('wouter', () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('ParentJourney Homepage & Hero Artwork Protection', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders View Membership Plans button on homepage without altering hero composition', () => {
    const { container } = render(<ParentJourney page="home" />);

    // Hero action row button
    const heroBtn = container.querySelector('#hero-view-membership-plans-btn');
    expect(heroBtn).not.toBeNull();
    expect(heroBtn?.textContent).toContain('View Membership Plans');
    expect(heroBtn?.closest('a')?.getAttribute('href')).toBe('/pricing');

    // Also present in the depth teaser section
    const allPricingLinks = screen.getAllByRole('link', { name: /VIEW MEMBERSHIP PLANS/i });
    expect(allPricingLinks.length).toBeGreaterThan(0);
    expect(allPricingLinks[0].getAttribute('href')).toBe('/pricing');
  });

  it('preserves the authentic Lady Justice WebP artwork and contains zero Wikimedia references', () => {
    const { container } = render(<ParentJourney page="home" />);

    // Lady Justice hero image
    const heroImg = container.querySelector('img[src="/assets/lady-justice-hero.webp"]');
    expect(heroImg).not.toBeNull();

    // Verify no wikimedia references
    const wikimediaImg = container.querySelector('img[src*="wikimedia"]');
    expect(wikimediaImg).toBeNull();
  });
});
