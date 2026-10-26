# AcroForm field ingestion (flagged, OFF by default)

## What it does
`POST /api/acroform/ingest` reads a PDF's form fields in memory and returns **field facts**. Each fact says:
- **presence**: the field exists on the form;
- **entered value**: what is in it, or null when blank or conflicting;
- **label role**: only when printed text on the page confirms it (otherwise `NOT_ESTABLISHED`);
- **row attribution**: only from a printed row label, a printed column header, and a row label unique on its page;
- **party attribution** (always `NOT_DETERMINED`) and **legal significance** (always `NOT_ASSESSED`).

It stores nothing, calls no paid model, and makes no database or billing call. Facts pass through
`applyReportGuards`, the analyzer's existing boundary.

## Flag
`ACROFORM_FIELD_INGESTION` must be exactly `true` to enable the route. Unset, `1`, `TRUE`, or anything else means
the route answers 404 with no other work. The flag is **not set in any environment**. Enabling it in production
needs the owner's explicit approval.

## What is verified
- Real current official PDF (14A): identified by pinned SHA-256 and byte length; 20 fields, 19 confirmed. Same as the
  recorded mapping record.
- Synthetic PDFs (generated in tests): printed labels, text fields, a checkbox, a radio group, a name on two pages,
  an unlabelled field, an ambiguous row label, an unambiguous row, an overlong value, and a file with no printed text.
- Malformed, non-PDF, oversize, and wrong-type input: classified errors, never a server error.

## Not established (remain before production activation)
- Table boundaries are not detected. Row attribution applies only in the narrow case above.
- Continuation tables across pages are not linked.
- Most fields on the other five current forms are unresolved (see the mapping record).
- No client UI consumes these facts; the route is API-only.
- No activation review, load test, or privacy review of uploaded documents has been done.
