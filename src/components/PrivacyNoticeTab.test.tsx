// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import PrivacyNoticeTab from './PrivacyNoticeTab';

afterEach(() => cleanup());

describe('Stage 11 Slice 5: Privacy Notice Publication', () => {
  it('renders approved privacy notice section title and governance version', () => {
    render(<PrivacyNoticeTab />);

    expect(screen.getByRole('heading', { name: /Privacy Policy & Professional Access Notice/i })).toBeDefined();
    expect(screen.getByText(/v1.0/i)).toBeDefined();
    expect(screen.getByText(/1. Overview of Professional Access & Data Protection/i)).toBeDefined();
  });

  it('contains data minimization notice and token security details', () => {
    render(<PrivacyNoticeTab />);

    expect(screen.getAllByText(/Data Minimization Notice:/i)[0]).toBeDefined();
    expect(screen.getAllByText(/No Plaintext Secret Storage:/i)[0]).toBeDefined();
    expect(screen.getAllByText(/Cryptographic Hashing:/i)[0]).toBeDefined();
  });

  it('provides privacy contact administrator details', () => {
    render(<PrivacyNoticeTab />);

    expect(screen.getAllByText(/Chris Pelkie/i)[0]).toBeDefined();
    expect(screen.getAllByText(/Chris@CYFSANavigator.com/i)[0]).toBeDefined();
  });
});

describe('Privacy policy — Facebook marketing integration section', () => {
  it('keeps the existing professional-access sections and adds the Facebook section', () => {
    render(<PrivacyNoticeTab />);
    expect(screen.getByText(/1. Overview of Professional Access & Data Protection/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: /9. Facebook Marketing Integration/i })).toBeDefined();
  });

  it('names the exact Facebook permissions and states that no parent accounts are used', () => {
    render(<PrivacyNoticeTab />);
    expect(screen.getAllByText(/pages_manage_posts/i)[0]).toBeDefined();
    expect(screen.getAllByText(/does not use parents' personal Facebook accounts/i)[0]).toBeDefined();
  });

  it('links to the data deletion instructions', () => {
    render(<PrivacyNoticeTab />);
    const link = screen.getAllByRole('link', { name: 'Data Deletion Instructions' })[0];
    expect(link.getAttribute('href')).toBe('/data-deletion');
  });
});
