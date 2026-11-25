// Shared renderer for an Insights article body (markdown source, verbatim).
// Used by the /insights list-detail pane for both /insights and each article's own route.
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Drop the front matter and the article's own H1 (the page supplies the heading). */
export function articleBody(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "").replace(/^# [^\n]*\n+/, "");
}

type ArticleBodyProps = {
  source: string;
  /** Handle a same-site link (href starting with "/"). Return true if handled client-side. */
  onInternalLink?: (href: string, event: MouseEvent<HTMLAnchorElement>) => boolean;
  /**
   * Shift section headings down one level (## -> h3) when the article sits under an h2,
   * keeping the outline correct. Visual size stays the same via the article-h2/article-h3 classes.
   */
  nested?: boolean;
};

export function ArticleBody({ source, onInternalLink, nested = false }: ArticleBodyProps) {
  const body = articleBody(source);
  // 1-based source lines where each markdown table starts, so table regions get stable, unique labels.
  const tableLines = body.split("\n").flatMap((line, index, lines) => (line.startsWith("|") && !lines[index - 1]?.startsWith("|") ? [index + 1] : []));
  const heading = (level: 2 | 3) => ({ node: _node, children, ...props }: { node?: unknown; children?: ReactNode }) => {
    const Tag = (nested ? `h${level + 1}` : `h${level}`) as "h2" | "h3" | "h4";
    return <Tag className={`article-h${level}`} {...props}>{children}</Tag>;
  };
  return (
    <div className="markdown-body article-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: heading(2),
          h3: heading(3),
          table: ({ node, ...props }) => {
            const tableNumber = tableLines.indexOf(node?.position?.start.line ?? -1) + 1;
            return (
              <div className="article-table-wrap" role="region" aria-label={`Article table ${tableNumber || ""}`.trim()} tabIndex={0}>
                <table {...props} />
              </div>
            );
          },
          // An empty corner header cell is decorative; render it as a plain cell so it isn't announced as a header.
          th: ({ node: _node, children, ...props }) => (children === undefined || children === null || children === "" ? <td className="article-table-corner" /> : <th {...props}>{children}</th>),
          a: ({ node: _node, href = "", ...props }) => {
            if (href.startsWith("/") && onInternalLink) {
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    if (onInternalLink(href, event)) event.preventDefault();
                  }}
                  {...props}
                />
              );
            }
            return <a href={href} {...props} />;
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
