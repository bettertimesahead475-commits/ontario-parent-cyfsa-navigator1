/**
 * A document title is never evidence of legal effect. This only decides whether the title names an order-type
 * document, so that the parent is told the report does not show whether it is final, signed, entered, served,
 * or in effect.
 *
 * This check fails closed: an order-type word anywhere in the title triggers the caveat, including inside
 * "Final_Order", "FinalOrder" or "Order2026". A wrong "no caveat" is the riskier error, so substring matching
 * is used on purpose. It over-warns on a few words such as "Recorder"; that is accepted.
 */
const ORDER_TYPE_WORD = /(order|endorse|judg(?:e)?ment|decision|ruling)/i;

export function titleSuggestsCourtOrder(documentType: string): boolean {
  return ORDER_TYPE_WORD.test(documentType);
}
