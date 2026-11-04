"use client";

import type { ReactNode } from "react";

/**
 * Minimal Markdown renderer for assistant prose: headings, lists, tables, inline code,
 * bold and links-as-text. Deliberately small — the project has no runtime Markdown
 * dependency, and assistant output only needs these few constructs.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  let index = 0;

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${index}`} className="font-semibold text-zinc-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={`${keyPrefix}-c-${index}`} className="rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] text-zinc-800">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
    index += 1;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

export function CopilotMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) {
      return;
    }
    const items = [...listBuffer];
    listBuffer = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="my-2 list-disc space-y-1 pl-5">
        {items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, `li-${key}-${itemIndex}`)}</li>
        ))}
      </ul>,
    );
  }

  function flushParagraph() {
    if (paragraphBuffer.length === 0) {
      return;
    }
    const text = paragraphBuffer.join("\n");
    paragraphBuffer = [];
    blocks.push(
      <p key={`p-${key++}`} className="my-2 whitespace-pre-wrap leading-relaxed">
        {renderInline(text, `p-${key}`)}
      </p>,
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*$/.test(line)) {
      flushList();
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushList();
      flushParagraph();
      const level = headingMatch[1].length;
      const size = level <= 2 ? "text-base" : "text-sm";
      blocks.push(
        <p key={`h-${key++}`} className={`mt-3 mb-1 font-semibold text-zinc-900 ${size}`}>
          {renderInline(headingMatch[2], `h-${key}`)}
        </p>,
      );
      continue;
    }

    const listMatch = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1]);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushList();
      flushParagraph();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes("|") && !/^\s*$/.test(lines[cursor])) {
        rows.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      index = cursor - 1;
      blocks.push(
        <div key={`t-${key++}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200">
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex} className="px-2 py-1.5 font-semibold text-zinc-700">
                    {renderInline(cell, `th-${key}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-zinc-100 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-2 py-1.5 text-zinc-600">
                      {renderInline(cell, `td-${key}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushList();
  flushParagraph();

  return <div className="text-sm text-zinc-700">{blocks}</div>;
}
