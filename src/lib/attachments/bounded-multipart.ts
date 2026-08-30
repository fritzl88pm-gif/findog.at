import { once } from "node:events";

import Busboy, { type BusboyFileStream, type BusboyInstance } from "@fastify/busboy";

import { UserVisibleError } from "@/lib/errors";

export type BoundedMultipartFileRule = {
  maxCount: number;
  maxBytes: number;
  tooManyMessage: string;
  tooLargeMessage: string;
};

export type BoundedMultipartFieldRule = {
  maxCount: number;
  maxBytes: number;
  invalidMessage: string;
};

export type BoundedMultipartFile = {
  fieldName: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type BoundedMultipartField = {
  name: string;
  value: string;
};

type ParseBoundedMultipartOptions = {
  request: Request;
  signal?: AbortSignal;
  contentType: string;
  maxBytes: number;
  maxFileAggregateBytes: number;
  fileRules: Readonly<Record<string, BoundedMultipartFileRule>>;
  fieldRules: Readonly<Record<string, BoundedMultipartFieldRule>>;
  emptyMessage: string;
  invalidMessage: string;
  tooLargeMessage: string;
  fileAggregateTooLargeMessage: string;
};

export type BoundedMultipartResult = {
  files: BoundedMultipartFile[];
  fields: BoundedMultipartField[];
};

type IndexedMultipartFile = BoundedMultipartFile & { partIndex: number };

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function sumRuleCounts(
  rules: Readonly<Record<string, { maxCount: number }>>,
  name: string,
): number {
  return Object.values(rules).reduce(
    (sum, rule) => sum + positiveSafeInteger(rule.maxCount, name),
    0,
  );
}

function largestRuleBytes(
  rules: Readonly<Record<string, { maxBytes: number }>>,
  name: string,
): number {
  const values = Object.values(rules).map((rule) => positiveSafeInteger(rule.maxBytes, name));
  return values.length > 0 ? Math.max(...values) : 1;
}

function safeParserError(error: unknown, invalidMessage: string): UserVisibleError {
  return error instanceof UserVisibleError
    ? error
    : new UserVisibleError(invalidMessage, 400);
}

/**
 * Stream multipart parts through Busboy while enforcing request, part-count,
 * per-file and aggregate-file limits. After a part completes, its accepted
 * contents are retained as contiguous bytes; no complete request body or File
 * copy is created.
 */
export async function parseBoundedMultipart(
  options: ParseBoundedMultipartOptions,
): Promise<BoundedMultipartResult> {
  const { request } = options;
  if (!request.body) {
    throw new UserVisibleError(options.emptyMessage, 400);
  }

  const maxBytes = positiveSafeInteger(options.maxBytes, "maxBytes");
  const maxFileAggregateBytes = positiveSafeInteger(
    options.maxFileAggregateBytes,
    "maxFileAggregateBytes",
  );
  const maxFiles = sumRuleCounts(options.fileRules, "file maxCount");
  const maxFields = sumRuleCounts(options.fieldRules, "field maxCount");
  const maxFileBytes = largestRuleBytes(options.fileRules, "file maxBytes");
  const maxFieldBytes = largestRuleBytes(options.fieldRules, "field maxBytes");

  let parser: BusboyInstance;
  try {
    parser = Busboy({
      headers: { "content-type": options.contentType },
      limits: {
        fieldNameSize: 64,
        fieldSize: maxFieldBytes,
        fields: maxFields,
        fileSize: maxFileBytes,
        files: maxFiles,
        parts: maxFiles + maxFields,
        headerPairs: 16,
        headerSize: 8 * 1_024,
      },
    });
  } catch {
    throw new UserVisibleError(options.invalidMessage, 400);
  }

  const reader = request.body.getReader();
  const indexedFiles: IndexedMultipartFile[] = [];
  const fields: BoundedMultipartField[] = [];
  const fileCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();
  const fileTasks: Promise<void>[] = [];
  const activeFileStreams = new Set<BusboyFileStream>();
  let requestBytes = 0;
  let aggregateFileBytes = 0;
  let partIndex = 0;
  let failure: UserVisibleError | undefined;

  const fail = (error: UserVisibleError) => {
    failure ??= error;
  };
  const failInvalid = () => fail(new UserVisibleError(options.invalidMessage, 400));

  parser.on("filesLimit", failInvalid);
  parser.on("fieldsLimit", failInvalid);
  parser.on("partsLimit", failInvalid);

  parser.on("field", (name, value, nameTruncated, valueTruncated) => {
    if (failure) return;
    const rule = options.fieldRules[name];
    const nextCount = (fieldCounts.get(name) ?? 0) + 1;
    if (
      !rule
      || nameTruncated
      || valueTruncated
      || nextCount > rule.maxCount
      || Buffer.byteLength(value, "utf8") > rule.maxBytes
    ) {
      fail(new UserVisibleError(rule?.invalidMessage ?? options.invalidMessage, 400));
      return;
    }
    fieldCounts.set(name, nextCount);
    fields.push({ name, value });
  });

  parser.on("file", (fieldName, stream, filename, _transferEncoding, mimeType) => {
    const currentPartIndex = partIndex;
    partIndex += 1;
    const rule = options.fileRules[fieldName];
    const nextCount = (fileCounts.get(fieldName) ?? 0) + 1;
    if (!rule || nextCount > rule.maxCount || failure) {
      if (!failure) {
        fail(new UserVisibleError(rule?.tooManyMessage ?? options.invalidMessage, 400));
      }
      stream.on("error", () => undefined);
      stream.resume();
      return;
    }
    fileCounts.set(fieldName, nextCount);
    activeFileStreams.add(stream);

    const task = consumeFilePart({
      stream,
      fieldName,
      filename,
      mimeType,
      rule,
      currentPartIndex,
      addFileBytes(chunkBytes) {
        if (chunkBytes > maxFileAggregateBytes - aggregateFileBytes) {
          fail(new UserVisibleError(options.fileAggregateTooLargeMessage, 413));
          return false;
        }
        aggregateFileBytes += chunkBytes;
        return true;
      },
      fail,
      files: indexedFiles,
    });
    fileTasks.push(task);
    void task.finally(() => activeFileStreams.delete(stream));
    void task.catch(() => undefined);
  });

  const parserDone = new Promise<void>((resolve, reject) => {
    parser.once("finish", resolve);
    // Keep the listener installed: destroying an incomplete multipart stream
    // can surface one error from the writable and another from the active part.
    parser.on("error", reject);
  });
  void parserDone.catch(() => undefined);
  const abortParser = (error: unknown) => {
    for (const stream of activeFileStreams) {
      if (!stream.destroyed) stream.destroy(error instanceof Error ? error : undefined);
    }
    if (!parser.destroyed) parser.destroy(error instanceof Error ? error : undefined);
  };
  const abortSignals: AbortSignal[] = [request.signal];
  if (options.signal && options.signal !== request.signal) {
    abortSignals.push(options.signal);
  }
  const abortListeners = abortSignals.map((signal) => {
    const onAbort = () => {
      const reason = signal.reason instanceof Error
        ? signal.reason
        : new Error("Multipart request aborted");
      fail(signal.reason instanceof UserVisibleError
        ? signal.reason
        : new UserVisibleError(options.invalidMessage, 400));
      abortParser(reason);
      void reader.cancel(reason).catch(() => undefined);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });

  try {
    while (!failure) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - requestBytes) {
        fail(new UserVisibleError(options.tooLargeMessage, 413));
        break;
      }
      requestBytes += value.byteLength;
      const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const canContinue = parser.write(buffer);
      if (failure) break;
      if (!canContinue) await once(parser, "drain");
    }

    if (failure) {
      abortParser(failure);
      void reader.cancel(failure).catch(() => undefined);
      await Promise.allSettled(fileTasks);
      throw failure;
    }

    parser.end();
    await Promise.all([parserDone, ...fileTasks]);
    if (failure) throw failure;
    indexedFiles.sort((left, right) => left.partIndex - right.partIndex);
    return {
      files: indexedFiles.map((file) => ({
        fieldName: file.fieldName,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        bytes: file.bytes,
      })),
      fields,
    };
  } catch (error) {
    abortParser(error);
    void reader.cancel(error).catch(() => undefined);
    await Promise.allSettled(fileTasks);
    throw safeParserError(failure ?? error, options.invalidMessage);
  } finally {
    for (const { signal, onAbort } of abortListeners) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }
}

function consumeFilePart(options: {
  stream: BusboyFileStream;
  fieldName: string;
  filename: string;
  mimeType: string;
  rule: BoundedMultipartFileRule;
  currentPartIndex: number;
  addFileBytes(bytes: number): boolean;
  fail(error: UserVisibleError): void;
  files: IndexedMultipartFile[];
}): Promise<void> {
  const chunks: Buffer[] = [];
  let fileBytes = 0;
  let settled = false;

  return new Promise((resolve) => {
    const settle = () => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      resolve();
    };

    options.stream.on("limit", () => {
      options.fail(new UserVisibleError(options.rule.tooLargeMessage, 413));
    });
    options.stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (
        chunk.byteLength > options.rule.maxBytes - fileBytes
        || !options.addFileBytes(chunk.byteLength)
      ) {
        options.fail(new UserVisibleError(options.rule.tooLargeMessage, 413));
        return;
      }
      fileBytes += chunk.byteLength;
      chunks.push(chunk);
    });
    options.stream.on("error", (error) => {
      options.fail(safeParserError(error, "Die Formulardaten konnten nicht gelesen werden."));
      settle();
    });
    options.stream.once("end", () => {
      if (options.stream.truncated) {
        options.fail(new UserVisibleError(options.rule.tooLargeMessage, 413));
        settle();
        return;
      }
      const combined = Buffer.concat(chunks, fileBytes);
      options.files.push({
        fieldName: options.fieldName,
        name: options.filename,
        mimeType: options.mimeType,
        sizeBytes: fileBytes,
        bytes: new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength),
        partIndex: options.currentPartIndex,
      });
      settle();
    });
    options.stream.once("close", settle);
  });
}
