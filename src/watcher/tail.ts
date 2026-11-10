import { open } from "node:fs/promises";

/** First bytes of a file as complete lines (a cut-off last line is dropped). */
export async function readHead(file: string, maxBytes = 64 * 1024): Promise<string[]> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    const lines = text.split("\n");
    if (bytesRead === maxBytes || !text.endsWith("\n")) lines.pop();
    return lines.map((l) => l.replace(/\r$/, ""));
  } finally {
    await fh.close();
  }
}

const CHUNK = 4 * 1024 * 1024;

type State = { offset: number; rest: Buffer; line: number };

/**
 * Byte-offset reader. Hands back only complete lines; a torn last line stays buffered until its
 * newline arrives. A file that shrinks is read again from the start.
 */
export class Tailer {
  private files = new Map<string, State>();

  has(file: string): boolean {
    return this.files.has(file);
  }

  /** Start tracking at the current end so only future appends are read. */
  skipToEnd(file: string, size: number): void {
    this.files.set(file, { offset: size, rest: Buffer.alloc(0), line: 1 });
  }

  /** Yields batches of new complete lines with the 1-based number of the first line in each batch. */
  async *read(file: string): AsyncGenerator<{ lines: string[]; firstLine: number }> {
    let st = this.files.get(file);
    if (!st) {
      st = { offset: 0, rest: Buffer.alloc(0), line: 1 };
      this.files.set(file, st);
    }
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      if (size < st.offset) {
        st.offset = 0;
        st.rest = Buffer.alloc(0);
        st.line = 1;
      }
      while (st.offset < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - st.offset));
        const { bytesRead } = await fh.read(buf, 0, buf.length, st.offset);
        if (bytesRead === 0) break;
        st.offset += bytesRead;
        const data = Buffer.concat([st.rest, buf.subarray(0, bytesRead)]);
        const nl = data.lastIndexOf(0x0a);
        if (nl < 0) {
          st.rest = data;
          continue;
        }
        st.rest = data.subarray(nl + 1);
        const lines = data.subarray(0, nl).toString("utf8").split("\n").map((l) => l.replace(/\r$/, ""));
        const firstLine = st.line;
        st.line += lines.length;
        yield { lines, firstLine };
      }
    } finally {
      await fh.close();
    }
  }
}
