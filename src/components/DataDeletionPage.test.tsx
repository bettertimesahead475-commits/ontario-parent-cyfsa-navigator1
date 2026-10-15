// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import DataDeletionPage from './DataDeletionPage';

afterEach(() => cleanup());

describe('Data deletion instructions page', () => {
  it('renders the page heading as the only h1 and needs no sign-in', () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Data Deletion Instructions/i })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('gives a working contact email in plain text and as a mailto link', () => {
    render(<DataDeletionPage />);
    const links = screen.getAllByRole('link', { name: 'chris@cyfsanavigator.com' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toMatch(/^mailto:chris@cyfsanavigator\.com\?subject=/);
  });

  it('separates revoking Facebook permissions from deleting CYFSA records', () => {
    render(<DataDeletionPage />);
    expect(screen.getByRole('heading', { name: /Revoking Facebook permissions is not the same/i })).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Revoke permissions' })).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Delete our records' })).toBeDefined();
  });

  it('states what is not automated and does not claim a retention period or certification', () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/does not currently have an automatic deletion process/i)).toBeDefined();
    expect(screen.getByText(/have not set fixed retention periods/i)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/\bISO \d|\bSOC 2\b|\bcertified\b/i);
  });

  it('links back to the privacy policy and never asks for a password', () => {
    render(<DataDeletionPage />);
    const privacy = screen.getAllByRole('link', { name: 'Privacy Policy' });
    expect(privacy[0].getAttribute('href')).toBe('/privacy');
    expect(document.body.textContent).toMatch(/Please do not send your Facebook password/i);
  });
});
