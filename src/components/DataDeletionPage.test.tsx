// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import DataDeletionPage from './DataDeletionPage';

afterEach(() => cleanup());

describe('Data deletion instructions page', () => {
  it('renders one h1 and needs no sign-in', () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Data Deletion Instructions/i })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('gives a working contact email as a mailto link with a prefilled subject', () => {
    render(<DataDeletionPage />);
    const links = screen.getAllByRole('link', { name: 'chris@cyfsanavigator.com' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toMatch(/^mailto:chris@cyfsanavigator\.com\?subject=/);
  });

  it('labels Facebook features as live or not yet available', () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole('heading', { name: /What is live and what is not/i })).toBeDefined();
    expect(screen.getAllByText(/Not yet available/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/No Facebook Page is connected/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Available now/i).length).toBeGreaterThan(0);
  });

  it('separates removing permissions from deleting CYFSA records', () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole('heading', { name: /Removing permissions is not the same/i })).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Remove permissions' })).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Delete our records' })).toBeDefined();
  });

  it('states that revocation and deletion are not automated', () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/does not call Facebook to revoke permissions/i)).toBeDefined();
    expect(screen.getByText(/Requests are processed manually/i)).toBeDefined();
  });

  it('does not promise a response deadline or claim certification', () => {
    render(<DataDeletionPage />);
    expect(document.body.textContent).toMatch(/do not state a guaranteed response time/i);
    expect(document.body.textContent).not.toMatch(/within \d+ (days|hours|business days)/i);
    expect(document.body.textContent).not.toMatch(/\bISO \d|\bSOC 2\b|\bcertified\b/i);
  });

  it('describes verification, decision and confirmation', () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/Verification:/i)).toBeDefined();
    expect(screen.getByText(/we email you to confirm what was deleted/i)).toBeDefined();
  });

  it('links back to the privacy policy and never asks for a password', () => {
    render(<DataDeletionPage />);
    const privacy = screen.getAllByRole('link', { name: 'Privacy Policy' });
    expect(privacy[0].getAttribute('href')).toBe('/privacy');
    expect(document.body.textContent).toMatch(/Do not send your Facebook password/i);
  });
});
