import React from "react";

export interface FormattedReportTextProps {
  content?: string | null;
  className?: string;
  variant?: "body" | "callout" | "quote" | "list-item";
}

/**
 * Formats AI-generated analysis text into clean, professional, accessible typography.
 * Converts markdown bold (**text**), bullet points (- or *), numbered lists (1.),
 * and paragraph breaks into native React elements while eliminating raw markdown syntax,
 * escaped quotes, and computer-code appearance.
 */
export const FormattedReportText: React.FC<FormattedReportTextProps> = ({
  content,
  className = "",
}) => {
  if (!content || typeof content !== "string") return null;

  // Clean unescaped newlines and literal quote escapes
  const sanitized = content
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();

  if (!sanitized) return null;

  // Split into lines/paragraphs
  const rawLines = sanitized.split(/\n+/);

  interface Block {
    type: "bullet" | "numbered" | "paragraph";
    text: string;
    num?: string;
  }

  const blocks: Block[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);

    if (bulletMatch) {
      blocks.push({ type: "bullet", text: bulletMatch[1] });
    } else if (numberedMatch) {
      blocks.push({ type: "numbered", text: numberedMatch[2], num: numberedMatch[1] });
    } else {
      blocks.push({ type: "paragraph", text: trimmed });
    }
  }

  // Parse inline bolding (**text**) without dangerous innerHTML
  const renderInline = (lineText: string): React.ReactNode => {
    const parts = lineText.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return (
          <strong key={idx} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  return (
    <div className={`space-y-1.5 font-sans leading-relaxed text-slate-700 text-xs ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === "bullet") {
          return (
            <div key={i} className="flex items-start gap-2 pl-0.5 my-0.5">
              <span className="text-brand-600 font-bold text-xs mt-0.5 select-none shrink-0">•</span>
              <span className="leading-relaxed text-slate-700">{renderInline(block.text)}</span>
            </div>
          );
        }
        if (block.type === "numbered") {
          return (
            <div key={i} className="flex items-start gap-2 pl-0.5 my-0.5">
              <span className="font-bold text-brand-700 text-xs mt-0.5 select-none shrink-0 min-w-4 text-right">
                {block.num}.
              </span>
              <span className="leading-relaxed text-slate-700">{renderInline(block.text)}</span>
            </div>
          );
        }
        return (
          <p key={i} className="leading-relaxed text-slate-700">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
};

export default FormattedReportText;
