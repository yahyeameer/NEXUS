// Greedy word wrap for canvas panels. Pure, with the measure function injected so it is testable without a canvas.

/**
 * `firstLineWidth` is for a line that starts after something else on its row (a badge): only the first line is
 * shorter, and the rest run the full width instead of all being squeezed.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, firstLineWidth = maxWidth): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= (lines.length === 0 ? firstLineWidth : maxWidth) || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
