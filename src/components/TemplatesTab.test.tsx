// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TemplatesTab from './TemplatesTab';

describe('TemplatesTab: Educational Preparation Builders & Official Form Boundaries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders educational builder heading and clear non-official disclaimer', () => {
    render(<TemplatesTab />);

    expect(screen.getByText(/EDUCATIONAL PREPARATION BUILDERS \(Not Official Forms\)/i)).toBeDefined();
    expect(screen.getAllByText(/EDUCATIONAL TEMPLATES ONLY — NOT OFFICIAL COURT FORMS/i).length).toBeGreaterThan(0);
  });

  it('renders all 7 educational builder navigation buttons', () => {
    render(<TemplatesTab />);

    expect(screen.getAllByText(/1\. 📝 Affidavit Prep/i)[0]).toBeDefined();
    expect(screen.getAllByText(/2\. 📅 Timeline Tracker/i)[0]).toBeDefined();
    expect(screen.getAllByText(/3\. 📋 Evidence Log/i)[0]).toBeDefined();
    expect(screen.getAllByText(/4\. ⚖️ Issue Sheet/i)[0]).toBeDefined();
    expect(screen.getAllByText(/5\. 🎯 Prep Sheet/i)[0]).toBeDefined();
    expect(screen.getAllByText(/6\. 📋 Educational: Respondent Answer \(Maps to Official Form 33B\.1\)/i)[0]).toBeDefined();
    expect(screen.getAllByText(/7\. 💝 Plan of Care Prep/i)[0]).toBeDefined();
  });

  it('displays critical Form 33B.1 guidance when Answer tab is selected', () => {
    render(<TemplatesTab />);

    const answerTabBtn = screen.getAllByText(/6\. 📋 Educational: Respondent Answer \(Maps to Official Form 33B\.1\)/i)[0];
    fireEvent.click(answerTabBtn);

    // Should display guidance that respondents file Form 33B.1, not Form 33B
    expect(screen.getAllByText(/FORM 33B\.1/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Respondent Answer & Care Plan Preparation \(Form 33B\.1\)/i)).toBeDefined();
    expect(screen.getByText(/Form 33B is exclusively for CAS care plans; parents must file Form 33B\.1/i)).toBeDefined();
  });

  it('contains prominent warning that educational materials must not be filed as official court forms', () => {
    render(<TemplatesTab />);

    expect(screen.getAllByText(/⚠️ EDUCATIONAL TEMPLATES ONLY — NOT OFFICIAL COURT FORMS/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NOT official Ontario Family Law Rules prescribed forms/i)[0]).toBeDefined();
  });
});
