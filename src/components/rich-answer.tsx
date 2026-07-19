import type { ReactNode } from "react";

import { parseRichAnswer, type RichBlock, type RichInline } from "@/lib/answer-rendering";

function renderRichInline(nodes: RichInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") return <span key={key}>{node.text}</span>;
    if (node.type === "strong") return <strong key={key}>{renderRichInline(node.children, key)}</strong>;
    if (node.type === "code") return <code key={key}>{node.text}</code>;
    if (node.type === "highlight") return <mark key={key}>{renderRichInline(node.children, key)}</mark>;
    return (
      <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
        {renderRichInline(node.children, key)}
      </a>
    );
  });
}

function renderRichBlock(block: RichBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const HeadingTag = `h${block.level}` as "h2" | "h3" | "h4";
    return <HeadingTag key={`heading-${index}`}>{renderRichInline(block.children, `heading-${index}`)}</HeadingTag>;
  }
  if (block.type === "paragraph") {
    return <p key={`paragraph-${index}`}>{renderRichInline(block.children, `paragraph-${index}`)}</p>;
  }
  if (block.type === "unordered-list") {
    return (
      <ul key={`unordered-list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`unordered-list-${index}-${itemIndex}`}>
            {renderRichInline(item, `unordered-list-${index}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "ordered-list") {
    return (
      <ol key={`ordered-list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`ordered-list-${index}-${itemIndex}`}>
            {renderRichInline(item, `ordered-list-${index}-${itemIndex}`)}
          </li>
        ))}
      </ol>
    );
  }
  if (block.type === "table") {
    return (
      <div className="answer-table-scroll" key={`table-${index}`}>
        <table>
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={`table-${index}-head-${cellIndex}`} scope="col">
                  {renderRichInline(cell, `table-${index}-head-${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`table-${index}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`table-${index}-row-${rowIndex}-${cellIndex}`}>
                    {renderRichInline(cell, `table-${index}-row-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <blockquote className="answer-callout" key={`blockquote-${index}`}>
      {renderRichInline(block.children, `blockquote-${index}`)}
    </blockquote>
  );
}

export default function RichAnswer({ content }: { content: string }) {
  const blocks = parseRichAnswer(content);
  if (blocks.length === 0) return <p className="message-body"></p>;
  return <div className="answer-content">{blocks.map(renderRichBlock)}</div>;
}
