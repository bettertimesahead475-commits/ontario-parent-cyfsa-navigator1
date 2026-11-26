# Synthetic demonstration documents

Fictional; no customer data. Use these for the Business Centre demonstration and the paid acceptance runs, so results
can be compared run to run. Each line under "Expected" is a check the report should pass; a miss is a finding.

| File | Analyzer | Expected |
|---|---|---|
| `demo-quick-letter.txt` (1 page) | Quick Document Review | Flags that "leaves Sam unsupervised at night" rests on an unnamed neighbour's statement the worker did not observe; quotes the neighbour and the parent word-for-word; s. 74(2)(b) and s. 81 verify against the CYFSA; notes the sister was not contacted |
| `demo-forensic-case-notes.txt` (6 pages) | Forensic Deep Scan | Contradiction: second visit dated 3 March (parent absent) and 5 March (parent present); supervisor's "pattern of neglect" has no new observation behind it; anonymous neighbour allegation unverified; CFSA s. 37(2)(b) identified as historical legislation (repealed 30 April 2018) for 2025 events; quotes located on the right pages |
| Both files together | Final Case Assessment | Summarises both documents without treating the neighbour allegations as fact; cites pages that exist |

Benchmark sizes (performance only, mocked inference): the 5/50/200-page synthetic generator in the performance
record, §5.
