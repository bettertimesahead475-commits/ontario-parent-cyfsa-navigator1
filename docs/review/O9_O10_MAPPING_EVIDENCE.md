# O9 and O10 evidence: table detection and mapping coverage

Measured on this machine against the six current official PDFs in `scripts/official-forms/current-manifest.json`
(files read from the upload folder; not modified). Commit `cc8e9e9` plus this package's commit. Read-only measurement.

## 1. Baseline by form (O10)

| File (form) | Pinned? | Pages | Fields (by name) | Confirmed by printed label | Unresolved | Conflicting | Radio groups |
|---|---|---|---|---|---|---|---|
| 35.1A | yes | 2 | 70 | 11 | 59 | 0 | 0 |
| 8B | yes | 7 | 122 | 12 | 110 | 0 | 0 |
| 33C | yes | 3 | 49 | 7 | 42 | 0 | 0 |
| 33B.1 | yes | 7 | 169 | 6 | 163 | 1 | 1 |
| unpinned file, name claims 33B (2018) | no | 4 | 53 | 6 | 47 | 1 | 2 |
| 14A | yes | 2 | 20 | 19 | 1 | 0 | 0 |
| **Total** | | | **483** | **61 (12.6%)** | **422** | **2** | **3** |

Widgets (before grouping by name): 501. Row attribution (O9): **0 of 501 widgets**, on every file.

The totals reproduce the checklist (483 fields, 61 confirmed). The unpinned file's name claims 33B (2018), but its bytes
do not match a pin, so it is reported as `UNIDENTIFIED`.

## 2. Why row attribution finds nothing (O9)

Row attribution, as implemented in `api/services/acroFormIngestion.ts`, needs all four of:
1. printed text on the same line to the left of the widget (the row label),
2. a header-like caption above the widget,
3. that caption repeated across at least two rows on the page (a real column), and
4. the row label unique on its page.

Measured on the 501 widgets:

| Signal | Widgets | Share |
|---|---|---|
| Has any printed text to the left (within 260 pt) | 67 | 13% |
| Has any printed text above (within 28 pt) | 251 | 50% |
| Has any printed text below (within 28 pt) | 193 | 50% |
| Has a column-header candidate (text over the widget's centre, within 90 pt) | 354 | 71% |
| Column header is header-like (short caption, no trailing punctuation) | 161 | 32% |

Conclusion: these forms place their printed labels above each field, not in table rows to the left. Rule 1 (a row label to
the left) is absent for 87% of widgets, so the rule cannot succeed on these files. Relaxing the rule to fit would be a
guess about table structure, and it could attach a value to the wrong person's row. This is why the rule was not changed.

## 3. Options for O9 (decision needed)

A. Do not build row attribution for these form layouts. Keep the field facts at presence and printed label only. This is
   the safest choice and matches the current design, which never assigns a party. Recommended until a real table form
   needs it.

B. Build a geometry-based table detector: column bands from widget x-positions, row bands from y-positions, a header row
   above each band. This needs at least one real multi-row table form with a pinned, verified original. None of the six
   current files is confirmed to contain a repeating row table of this kind. Validation would rely on synthetic tables
   alone, which is weaker evidence.

Recommendation: option A now. Revisit option B when the owner supplies a real table form with its original file and pin.

## 4. Options for O10 (decision needed)

Coverage is 61 of 483 (12.6%). The 422 unresolved fields are unresolved because no printed label was matched with one
clear rule. Ways to raise coverage:
- Add label phrases to the semantic dictionary, each reviewed by a person against the printed form. Each new phrase is a
  claim that a field means something. This needs the O7 and O8 reviews first.
- Widen the text capture windows. This changes which printed text the mapper sees and could create new false matches.
  Not done here.
- Relax the one-clear-match rule. Not done. The checklist records that the rule was not relaxed to raise this number.

Recommendation: keep 12.6% as the honest figure. Raise it only through a reviewed, phrase-by-phrase label list.

## 5. What this package does not change

No mapping rule, label phrase, extraction window, or attribution rule was changed. Numbers above come from the existing code.
