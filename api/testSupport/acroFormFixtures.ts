// Deterministic synthetic AcroForm PDFs for tests. Every label is printed text, and every widget is placed by
// coordinates, so the extractor's printed-text evidence can be checked. No real form content is used here.
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface SyntheticOptions {
  /** Entered value for the court-file text field on page 1. */
  courtFileValue?: string;
  /** Add a second widget with the same name on page 2 that carries a different value (conflict). */
  conflictingDuplicate?: boolean;
  /** Add a radio group with two options. */
  radioGroup?: boolean;
  /** Add a text field that is never labelled (no printed text anywhere near it). */
  unlabelledField?: boolean;
  /** Draw no printed text at all (provenance check for a file with nothing to quote). */
  bare?: boolean;
  /** Add a two-row table whose row label "Child" appears on two rows of the same page (ambiguous). */
  ambiguousRows?: boolean;
  /** Add a table row with a printed row label and a printed column header (unambiguous). */
  unambiguousRow?: boolean;
}

export async function buildSyntheticAcroFormPdf(opts: SyntheticOptions = {}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page1 = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  if (opts.bare) {
    const only = form.createTextField("bare_field");
    only.addToPage(page1, { x: 100, y: 500, width: 200, height: 20 });
    return Buffer.from(await pdf.save());
  }

  // Header: "Court File Number" printed above the field.
  page1.drawText("Court File Number", { x: 60, y: 620, size: 9, font });
  const court = form.createTextField("court_number_field");
  court.addToPage(page1, { x: 60, y: 590, width: 180, height: 20 });
  if (opts.courtFileValue !== undefined) court.setText(opts.courtFileValue);

  // Court office address label, printed to the left on the same line.
  page1.drawText("Court office address", { x: 60, y: 540, size: 9, font });
  const address = form.createTextField("address_field");
  address.addToPage(page1, { x: 200, y: 536, width: 240, height: 18 });

  if (opts.radioGroup) {
    page1.drawText("Placement", { x: 60, y: 480, size: 9, font });
    const radio = form.createRadioGroup("placement_choice");
    radio.addOptionToPage("temporary", page1, { x: 200, y: 478, width: 12, height: 12 });
    radio.addOptionToPage("permanent", page1, { x: 260, y: 478, width: 12, height: 12 });
  }

  if (opts.unlabelledField) {
    const stray = form.createTextField("stray_field");
    stray.addToPage(page1, { x: 400, y: 300, width: 120, height: 18 });
  }

  if (opts.unambiguousRow) {
    page1.drawText("Child's Full Legal Name", { x: 240, y: 420, size: 8, font });
    page1.drawText("Child 1", { x: 60, y: 396, size: 9, font });
    const name = form.createTextField("child_name_row");
    name.addToPage(page1, { x: 200, y: 392, width: 200, height: 18 });
    // A second row under the same header, so the column repeats across two rows.
    page1.drawText("Child 2", { x: 60, y: 366, size: 9, font });
    const nameTwo = form.createTextField("child_name_row_two");
    nameTwo.addToPage(page1, { x: 200, y: 362, width: 200, height: 18 });
  }

  if (opts.ambiguousRows) {
    page1.drawText("Name", { x: 290, y: 360, size: 8, font });
    page1.drawText("Child", { x: 60, y: 340, size: 9, font });
    const r1 = form.createTextField("child_row_one");
    r1.addToPage(page1, { x: 200, y: 336, width: 200, height: 18 });
    page1.drawText("Child", { x: 60, y: 300, size: 9, font });
    const r2 = form.createTextField("child_row_two");
    r2.addToPage(page1, { x: 200, y: 296, width: 200, height: 18 });
  }

  if (opts.conflictingDuplicate) {
    const page2 = pdf.addPage([612, 792]);
    page2.drawText("Court File Number", { x: 60, y: 620, size: 9, font });
    court.addToPage(page2, { x: 60, y: 590, width: 180, height: 20 });
    if (opts.courtFileValue !== undefined) court.setText(opts.courtFileValue);
  }

  return Buffer.from(await pdf.save());
}
