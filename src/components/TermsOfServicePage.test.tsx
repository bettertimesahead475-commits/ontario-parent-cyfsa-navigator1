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
    expect(screen.getByText(/Operator identity: confirm the legal name/)).toBeDefined();
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

  it('covers governing law in Ontario and keeps statutory rights', () => {
    render(<TermsOfServicePage />);
    expect(screen.getByText(/laws of the Province of Ontario/)).toBeDefined();
    expect(screen.getByText(/cannot be excluded or limited under Ontario or Canadian law/)).toBeDefined();
  });
});
