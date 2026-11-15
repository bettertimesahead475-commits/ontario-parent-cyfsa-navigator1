/**
 * CYFSA Navigator — Legal Text Pronunciation Pre-Processor for Text-to-Speech
 *
 * Prepares Ontario child-protection report text for faithful, human-sounding
 * speech synthesis without altering the underlying displayed document text.
 */

export function prepareLegalTextForSpeech(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText;

  // 1. Remove markdown bold, italic, code formatting
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  text = text.replace(/__(.*?)__/g, '$1');
  text = text.replace(/\*(.*?)\*/g, '$1');
  text = text.replace(/_(.*?)_/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');

  // 2. Normalize URLs
  text = text.replace(/https?:\/\/(?:www\.)?ontario\.ca\/laws\/[^\s\)]+/gi, 'Ontario e-Laws consolidation');
  text = text.replace(/https?:\/\/[^\s\)]+/gi, 'web reference');

  // 3. Judicial designations: "Campbell, J." -> "Justice Campbell", "A. Bignucolo, J." -> "Justice A. Bignucolo"
  text = text.replace(/([A-Z]\.?\s+[A-Z][a-zA-Z]+|[A-Z][a-zA-Z]+),\s*J\./g, 'Justice $1');

  // 4. Case citations: "Society v. Doe" -> "Society versus Doe"
  text = text.replace(/\b([A-Z][a-zA-Z]+)\s+v\.\s+([A-Z][a-zA-Z]+)\b/g, '$1 versus $2');

  // 5. Statutory sections & subsections:
  // Must match parenthesized clauses and subsections BEFORE matching standalone sections.
  // Using (?!\() prevents s. 74(2) from being prematurely truncated to section 74.
  text = text.replace(/\bss\.\s*(\d+)\((\d+)\)/gi, 'subsections $1, subsection $2');
  text = text.replace(/\bss\.\s*(\d+)(?!\()/gi, 'sections $1');
  text = text.replace(/\bs\.\s*(\d+)\((\d+)\)\(([a-z])\)/gi, 'section $1, subsection $2, clause $3');
  text = text.replace(/\bs\.\s*(\d+)\((\d+)\)/gi, 'section $1, subsection $2');
  text = text.replace(/\bs\.\s*(\d+)(?!\()/gi, 'section $1');
  text = text.replace(/\bSection\s+(\d+)\((\d+)\)/gi, 'Section $1, subsection $2');

  // 6. Family Law Rules & Ontario Regulations:
  text = text.replace(/\bFLR\s+(?:Rule\s+)?(\d+)\((\d+)\)/gi, 'Family Law Rules, rule $1, subrule $2');
  text = text.replace(/\bFLR\b/g, 'Family Law Rules');
  text = text.replace(/\bRule\s+(\d+)\((\d+)\)/gi, 'Rule $1, subrule $2');
  text = text.replace(/\br\.\s*(\d+)\((\d+)\)/gi, 'rule $1, subrule $2');
  text = text.replace(/O\.\s*Reg\.\s*(\d+)\/(\d+)/gi, 'Ontario Regulation $1 of $2');

  // 7. Statute Acronyms:
  text = text.replace(/\bCYFSA\b/g, 'C-Y-F-S-A');
  text = text.replace(/\bCLRA\b/g, 'C-L-R-A');
  text = text.replace(/\bCAS\b/g, 'C-A-S');
  text = text.replace(/\bUFC\b/g, 'Unified Family Court');
  text = text.replace(/\bESI\b/g, 'E-S-I');

  // 8. Paragraph citations:
  text = text.replace(/\bparas?\.\s*(\d+)\s*[-–—]\s*(\d+)\b/gi, 'paragraphs $1 to $2');
  text = text.replace(/\bparas?\.\s*(\d+)\b/gi, 'paragraph $1');
  text = text.replace(/\bpara\s+(\d+)\b/gi, 'paragraph $1');

  // 9. Finding identifiers:
  text = text.replace(/\brf[-_]?(\d+)\b/gi, 'Finding $1');

  // 10. Date abbreviations:
  text = text.replace(/\bJan\.\s+/g, 'January ');
  text = text.replace(/\bFeb\.\s+/g, 'February ');
  text = text.replace(/\bMar\.\s+/g, 'March ');
  text = text.replace(/\bApr\.\s+/g, 'April ');
  text = text.replace(/\bJun\.\s+/g, 'June ');
  text = text.replace(/\bJul\.\s+/g, 'July ');
  text = text.replace(/\bAug\.\s+/g, 'August ');
  text = text.replace(/\bSept?\.\s+/gi, 'September ');
  text = text.replace(/\bOct\.\s+/g, 'October ');
  text = text.replace(/\bNov\.\s+/g, 'November ');
  text = text.replace(/\bDec\.\s+/g, 'December ');

  // 11. Clean bullet characters & raw symbols
  text = text.replace(/^[•\-\*]\s+/gm, '');
  text = text.replace(/[\[\]]/g, ' ');
  text = text.replace(/[\/\\|]/g, ' ');

  // 12. Collapse multiple spaces and trim
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
