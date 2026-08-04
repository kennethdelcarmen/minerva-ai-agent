import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; blocks: MarkdownBlock[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string | null; code: string };

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isCodeFence(line: string): boolean {
  return line.trimStart().startsWith("```");
}

function isBlockquote(line: string): boolean {
  return /^>\s?/.test(line.trimStart());
}

function isOrderedListItem(line: string): boolean {
  return /^\d+\.\s+/.test(line.trimStart());
}

function isUnorderedListItem(line: string): boolean {
  return /^[-*+]\s+/.test(line.trimStart());
}

function isBlockStarter(line: string): boolean {
  return (
    isBlank(line) ||
    isHeading(line) ||
    isCodeFence(line) ||
    isBlockquote(line) ||
    isOrderedListItem(line) ||
    isUnorderedListItem(line)
  );
}

function parseBlocks(source: string): MarkdownBlock[] {
  const normalized = source.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    if (isCodeFence(line)) {
      const language = line.trim().slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !isCodeFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (isHeading(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        blocks.push({
          type: "heading",
          level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          text: match[2].trim(),
        });
      }
      index += 1;
      continue;
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && isBlockquote(lines[index])) {
        quoteLines.push(lines[index].trimStart().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({ type: "blockquote", blocks: parseBlocks(quoteLines.join("\n")) });
      continue;
    }

    if (isOrderedListItem(line) || isUnorderedListItem(line)) {
      const ordered = isOrderedListItem(line);
      const items: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        if (
          (ordered && !isOrderedListItem(currentLine)) ||
          (!ordered && !isUnorderedListItem(currentLine))
        ) {
          break;
        }

        items.push(currentLine.trimStart().replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ""));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStarter(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) {
    return trimmed;
  }

  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }

    const tokenKey = `${keyPrefix}-${tokenIndex}`;

    if (fullMatch.startsWith("`") && fullMatch.endsWith("`")) {
      nodes.push(
        <code key={tokenKey} className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[0.92em] text-[#f7efe2]">
          {fullMatch.slice(1, -1)}
        </code>,
      );
    } else if (
      (fullMatch.startsWith("**") && fullMatch.endsWith("**")) ||
      (fullMatch.startsWith("__") && fullMatch.endsWith("__"))
    ) {
      const inner = fullMatch.slice(2, -2);
      nodes.push(<strong key={tokenKey}>{renderInline(inner, `${tokenKey}-strong`)}</strong>);
    } else if (
      (fullMatch.startsWith("*") && fullMatch.endsWith("*")) ||
      (fullMatch.startsWith("_") && fullMatch.endsWith("_"))
    ) {
      const inner = fullMatch.slice(1, -1);
      nodes.push(<em key={tokenKey}>{renderInline(inner, `${tokenKey}-em`)}</em>);
    } else if (fullMatch.startsWith("[") && fullMatch.includes("](") && fullMatch.endsWith(")")) {
      const linkMatch = fullMatch.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        const safeHref = sanitizeHref(href);

        if (safeHref) {
          nodes.push(
            <a
              key={tokenKey}
              href={safeHref}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline decoration-primary/50 underline-offset-4 transition-colors hover:text-[#7de3db]"
            >
              {renderInline(label, `${tokenKey}-link`)}
            </a>,
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(fullMatch);
      }
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = matchIndex + fullMatch.length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const HeadingTag = `h${block.level}` as const;
      return (
        <HeadingTag key={key}>
          {renderInline(block.text, `${key}-heading`)}
        </HeadingTag>
      );
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.text, `${key}-paragraph`)}</p>;
    case "blockquote":
      return (
        <blockquote key={key}>
          {block.blocks.map((child, childIndex) => renderBlock(child, `${key}-blockquote-${childIndex}`))}
        </blockquote>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>{renderInline(item, `${key}-item-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return (
        <pre key={key}>
          {block.language ? <span className="markdown-code-label">{block.language}</span> : null}
          <code>{block.code}</code>
        </pre>
      );
    default:
      return null;
  }
}

function formatContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "No final answer was returned for this run.";
  }

  return JSON.stringify(value, null, 2);
}

export function MarkdownContent({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const content = formatContent(value);
  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return <p className={className}>No final answer was returned for this run.</p>;
  }

  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => renderBlock(block, `markdown-block-${index}`))}
    </div>
  );
}
