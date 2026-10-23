/**
 * A document title is never evidence of legal effect. This only decides whether the title names an order-type
 * document, so that the parent is told the report does not show whether it is final, signed, entered, served,
 * or in effect.
 */

// Titles that lead with a plainly non-order filing word are not treated as orders. Nouns such as "summary",
// "statement", "notice" or "report" do not exempt a title, so "Statement of Decision" still gets the caveat.
const NON_ORDER_LEAD = /^\s*(application|motion|request|affidavit|letter)\b/i;

export function titleSuggestsCourtOrder(documentType: string): boolean {
  return /\b(order|endorsement|judgment|decision)s?\b/i.test(documentType) && !NON_ORDER_LEAD.test(documentType);
}
