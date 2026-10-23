/**
 * A document title is never evidence of legal effect. This only decides whether the title names an order-type
 * document, so that the parent is told the report does not show whether it is final, signed, entered, served,
 * or in effect.
 *
 * This check fails closed: any order-type word triggers the caveat, whatever the title starts with. A
 * filing title such as "Motion Order" still gets the caveat, because a wrong "no caveat" is the riskier error.
 */
const ORDER_TYPE_WORD = /\b(orders?|endorse(?:ment|d|s)?|judg(?:e)?ments?|decisions?|rulings?)\b/i;

export function titleSuggestsCourtOrder(documentType: string): boolean {
  return ORDER_TYPE_WORD.test(documentType);
}
