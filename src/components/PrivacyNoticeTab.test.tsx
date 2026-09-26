// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import PrivacyNoticeTab from './PrivacyNoticeTab';

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
    expect(screen.getAllByText(/privacy@cyfsa-navigator.example.org/i)[0]).toBeDefined();
  });
});
