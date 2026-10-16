// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import TermsOfServicePage from './TermsOfServicePage';

afterEach(() => cleanup());

describe('Terms of Service page', () => {
  it('renders one h1 and needs no sign-in', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the draft review notice while the page is a draft', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/Draft for owner review\. These Terms are not yet in effect\./)).toBeDefined();
    expect(screen.getByText(/Operator identity: confirm that CYFSA Navigator is a sole proprietorship/)).toBeDefined();
  });

  it('marks the owner decisions that must be resolved before publication', () => {
    render(<TermsOfServicePage />);
    expect(document.querySelector('[data-owner-decision="refunds"]')).not.toBeNull();
    expect(document.querySelector('[data-owner-decision="liability-cap"]')).not.toBeNull();
    expect(document.querySelector('[data-owner-decision="effective-date"]')).not.toBeNull();
  });

  it('states the legal information disclaimers', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/We are not a law firm\./)).toBeDefined();
    expect(screen.getByText(/AI analysis is not legal advice\./)).toBeDefined();
    expect(screen.getByText(/No lawyer-client relationship\./)).toBeDefined();
    expect(screen.getByText(/AI can be wrong\./)).toBeDefined();
    expect(screen.getByText(/You remain responsible\./)).toBeDefined();
  });

  it('describes the third-party AI processing that the code actually uses', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/Anthropic's Claude models/)).toBeDefined();
    expect(screen.getAllByText(/Google \(Gemini models\)/).length).toBeGreaterThanOrEqual(2);
  });

  it('does not promise permanent deletion or confidentiality', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/We cannot promise that any document or result is kept confidential or permanently deleted/)).toBeDefined();
    expect(screen.queryByText(/permanently deleted within/i)).toBeNull();
  });

  it('describes payments as Interac e-Transfer only, without card or subscription claims', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/accepts payment by Interac e-Transfer only/)).toBeDefined();
    expect(screen.getByText(/does not renew automatically/)).toBeDefined();
    expect(screen.queryByText(/Stripe/i)).toBeNull();
  });

  it('separates buying credits from consuming them on successful completion', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/Buying credits and using credits are different\./)).toBeDefined();
    expect(screen.getByText(/A credit is used only when an analysis has been completed successfully/)).toBeDefined();
    expect(screen.getByText(/If an analysis fails before it completes, no credit is used/)).toBeDefined();
  });

  it('states the completed-analysis refund rule without limiting statutory remedies', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/Completed analyses are non-refundable, subject to applicable Ontario and Canadian consumer-protection laws\./)).toBeDefined();
    expect(screen.getByText(/does not limit any refund, correction, or other remedy required by law\./)).toBeDefined();
    expect(document.querySelector('[data-owner-decision="refunds"]')).not.toBeNull();
  });

  it('states that Facebook publishing and OAuth are not live', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/no Facebook Page is connected to the production site/)).toBeDefined();
    expect(screen.getByText(/does not yet use Facebook OAuth/)).toBeDefined();
  });

  it('links the privacy and data-deletion pages and the contact email', () => {
    render(<TermsOfServicePage />);
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' }).every((a) => a.getAttribute('href') === '/privacy')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Data Deletion Instructions' }).every((a) => a.getAttribute('href') === '/data-deletion')).toBe(true);
    const mail = screen.getAllByRole('link', { name: 'chris@cyfsanavigator.com' });
    expect(mail.length).toBeGreaterThan(0);
    expect(mail[0].getAttribute('href')).toBe('mailto:chris@cyfsanavigator.com');
  });

  it('designates the owner as privacy contact without claiming a certified or independent DPO', () => {
    render(<TermsOfServicePage />);
    expect(screen.getAllByText(/Chris Pelkie is the designated privacy contact/).length).toBeGreaterThan(0);
    expect(screen.getByText(/has not appointed an independent or legally certified Data Protection Officer/)).toBeDefined();
    expect(document.querySelector('[data-owner-decision="privacy-contact"]')).not.toBeNull();
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/(we|CYFSA Navigator) (have )?appointed (an? )?(independent |certified )*Data Protection Officer/i);
  });

  it('describes the operator as a sole proprietorship in Ontario', () => {
    render(<TermsOfServicePage />);
    expect(screen.getAllByText(/is a sole proprietorship operated by Chris Pelkie/).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-owner-decision="operator-identity"]')).not.toBeNull();
  });

  it('routes uploaded-document deletion requests to email, not the Facebook-only deletion page', () => {
    render(<TermsOfServicePage />);
    expect(screen.getAllByText(/cover Facebook-related information only/).length).toBeGreaterThan(0);
    expect(screen.getByText(/To ask us to delete them, email/)).toBeDefined();
  });

  it('flags the Platform-wide privacy notice gap instead of implying full coverage', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/currently describes how we handle personal information about professional access/)).toBeDefined();
    expect(document.querySelector('[data-owner-decision="privacy-notice"]')).not.toBeNull();
    expect(screen.queryByText(/explains what personal information we collect/)).toBeNull();
  });

  it('publishes no telephone number or street address', () => {
    const { container } = render(<TermsOfServicePage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/);
    expect(text).not.toMatch(/\b\d{1,5} [A-Z][a-z]+ (Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Crescent|Court)\b/);
  });

  it('covers governing law in Ontario and keeps statutory rights', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/laws of the Province of Ontario/)).toBeDefined();
    expect(screen.getByText(/cannot be excluded or limited under Ontario or Canadian law/)).toBeDefined();
  });
});
