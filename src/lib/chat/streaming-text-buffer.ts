type StreamingTextBufferOptions = {
  appendText: (text: string) => void;
  replaceText: (text: string) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
};

export type StreamingTextBuffer = {
  append: (text: string) => void;
  replace: (text: string) => void;
  flush: () => void;
  cancel: () => void;
};

export function createStreamingTextBuffer(
  options: StreamingTextBufferOptions,
): StreamingTextBuffer {
  let frame: number | null = null;
  let pendingAppend = "";
  let pendingReplacement: string | null = null;

  const drain = () => {
    const replacement = pendingReplacement;
    const appended = pendingAppend;
    pendingReplacement = null;
    pendingAppend = "";
    if (replacement !== null) options.replaceText(replacement);
    if (appended) options.appendText(appended);
  };

  const schedule = () => {
    if (frame !== null) return;
    frame = options.requestFrame(() => {
      frame = null;
      drain();
    });
  };

  return {
    append(text) {
      if (!text) return;
      pendingAppend += text;
      schedule();
    },
    replace(text) {
      pendingReplacement = text;
      pendingAppend = "";
      schedule();
    },
    flush() {
      if (frame !== null) {
        options.cancelFrame(frame);
        frame = null;
      }
      drain();
    },
    cancel() {
      if (frame !== null) options.cancelFrame(frame);
      frame = null;
      pendingReplacement = null;
      pendingAppend = "";
    },
  };
}
