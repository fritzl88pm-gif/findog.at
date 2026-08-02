export type StreamingMarkdown = {
  completed: string[];
  tail: string;
};

const blankLineBoundaryPattern = /\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/gu;

export function emptyStreamingMarkdown(): StreamingMarkdown {
  return {
    completed: [],
    tail: "",
  };
}

function partitionStreamingMarkdown(
  completed: string[],
  content: string,
): StreamingMarkdown {
  const settled = [...completed];
  let segmentStart = 0;

  for (const boundary of content.matchAll(blankLineBoundaryPattern)) {
    const boundaryStart = boundary.index;
    const boundaryEnd = boundaryStart + boundary[0].length;
    const segment = content.slice(segmentStart, boundaryEnd);
    if (segment.trim()) settled.push(segment);
    segmentStart = boundaryEnd;
  }

  return {
    completed: settled,
    tail: content.slice(segmentStart),
  };
}

export function appendStreamingMarkdown(
  current: StreamingMarkdown,
  delta: string,
): StreamingMarkdown {
  if (!delta) return current;
  return partitionStreamingMarkdown(current.completed, current.tail + delta);
}

export function replaceStreamingMarkdown(
  current: StreamingMarkdown,
  content: string,
): StreamingMarkdown {
  if (current.completed.length === 0 && current.tail === content) return current;
  return partitionStreamingMarkdown([], content);
}
