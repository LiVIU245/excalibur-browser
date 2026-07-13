import type { WireStackFrame } from './payload';

export interface StackFrame {
  lineNumber: number | null;
  columnNumber: number | null;
  className: string | null;
  fileName: string | null;
  methodName: string | null;
}

// Chrome/Edge: "    at Foo.bar (https://site/app.js:10:20)" | "    at https://site/app.js:10:20"
const CHROME_FRAME =
  /^\s*at (?:(.+?)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?$/;

// Firefox/Safari: "bar@https://site/app.js:10:20" | "@https://site/app.js:10:20"
const GECKO_FRAME =
  /^\s*(?:(.*?)@)?(\S+?):(\d+)(?::(\d+))?\s*$/;

function splitMethod(method: string | undefined): {
  className: string | null;
  methodName: string | null;
} {
  if (!method) return { className: null, methodName: null };

  const cleaned = method.replace(/^(async |new |get |set )+/, '');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastDot === -1) return { className: null, methodName: cleaned };

  return {
    className: cleaned.slice(0, lastDot),
    methodName: cleaned.slice(lastDot + 1),
  };
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  return Number(value);
}

function parseChromeLine(line: string): StackFrame | null {
  const match = CHROME_FRAME.exec(line);
  if (!match) return null;

  return {
    ...splitMethod(match[1]),
    fileName: match[2] ?? match[5] ?? null,
    lineNumber: toNumber(match[3]),
    columnNumber: toNumber(match[4]),
  };
}

function parseGeckoLine(line: string): StackFrame | null {
  const match = GECKO_FRAME.exec(line);
  if (!match) return null;

  return {
    ...splitMethod(match[1]),
    fileName: match[2] ?? null,
    lineNumber: toNumber(match[3]),
    columnNumber: toNumber(match[4]),
  };
}

export function parseStackTrace(stackString: string | undefined): StackFrame[] {
  if (!stackString) return [];

  const frames: StackFrame[] = [];
  for (const line of stackString.split('\n')) {
    // Skip the "Error: message" preamble Chrome includes.
    if (/^\s*\S*Error(:|$)/.test(line)) continue;

    const frame = parseChromeLine(line) ?? parseGeckoLine(line);
    if (frame) frames.push(frame);
  }

  return frames;
}

export function toWireFrame(frame: StackFrame): WireStackFrame {
  return {
    LineNumber: frame.lineNumber ?? undefined,
    ColumnNumber: frame.columnNumber ?? undefined,
    ClassName: frame.className ?? undefined,
    FileName: frame.fileName ?? undefined,
    MethodName: frame.methodName ?? undefined,
  };
}
