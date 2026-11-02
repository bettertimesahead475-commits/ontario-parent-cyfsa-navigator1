import { describe, it, expect } from 'vitest';
import { prepareLegalTextForSpeech } from './legalPronunciation';

describe('Legal Text Pronunciation Pre-Processor', () => {
  it('faithfully preserves exact legal content without summarizing', () => {
    const raw = 'The worker stated that the parent attended the scheduled access visit on time.';
    const speech = prepareLegalTextForSpeech(raw);
    expect(speech).toBe(raw);
  });

  it('correctly expands CYFSA section citations to spoken words', () => {
    expect(prepareLegalTextForSpeech('Under s. 88, a hearing is required within 5 days.'))
      .toBe('Under section 88, a hearing is required within 5 days.');

    expect(prepareLegalTextForSpeech('Refer to s. 74(2) for child in need of protection.'))
      .toBe('Refer to section 74, subsection 2 for child in need of protection.');

    expect(prepareLegalTextForSpeech('The Society cited ss. 74(2) in their application.'))
      .toBe('The Society cited subsections 74, subsection 2 in their application.');

    expect(prepareLegalTextForSpeech('Pursuant to s. 74(2)(b), the child was placed.'))
      .toBe('Pursuant to section 74, subsection 2, clause b, the child was placed.');
  });

  it('correctly expands Ontario court rules and regulations', () => {
    expect(prepareLegalTextForSpeech('Under FLR 14(18), information and belief is permitted.'))
      .toBe('Under Family Law Rules, rule 14, subrule 18, information and belief is permitted.');

    expect(prepareLegalTextForSpeech('Complies with Rule 14(18) on motions.'))
      .toBe('Complies with Rule 14, subrule 18 on motions.');

    expect(prepareLegalTextForSpeech('Governed by O. Reg. 114/99.'))
      .toBe('Governed by Ontario Regulation 114 of 99.');
  });

  it('correctly spaces statute acronyms for natural engine pronunciation', () => {
    expect(prepareLegalTextForSpeech('Under the CYFSA and CLRA proceedings.'))
      .toBe('Under the C-Y-F-S-A and C-L-R-A proceedings.');

    expect(prepareLegalTextForSpeech('The CAS worker attended.'))
      .toBe('The C-A-S worker attended.');

    expect(prepareLegalTextForSpeech('Report shows ESI score of 62.'))
      .toBe('Report shows E-S-I score of 62.');
  });

  it('correctly normalizes judicial titles and case versus designations', () => {
    expect(prepareLegalTextForSpeech('Decision reviewed by Campbell, J. in court.'))
      .toBe('Decision reviewed by Justice Campbell in court.');

    expect(prepareLegalTextForSpeech('In Society v. Doe, the court held.'))
      .toBe('In Society versus Doe, the court held.');
  });

  it('expands paragraph and finding citations', () => {
    expect(prepareLegalTextForSpeech('Documented in paras. 5-7 of the affidavit.'))
      .toBe('Documented in paragraphs 5 to 7 of the affidavit.');

    expect(prepareLegalTextForSpeech('As noted in para. 7.'))
      .toBe('As noted in paragraph 7.');

    expect(prepareLegalTextForSpeech('Flag rf1 indicates a concern.'))
      .toBe('Flag Finding 1 indicates a concern.');
  });

  it('normalizes month abbreviations and cleans markdown formatting', () => {
    expect(prepareLegalTextForSpeech('Email sent on **Sept. 19, 2025**.'))
      .toBe('Email sent on September 19, 2025.');

    expect(prepareLegalTextForSpeech('See https://www.ontario.ca/laws/statute/17c14#BK116 for details.'))
      .toBe('See Ontario e-Laws consolidation for details.');
  });
});
