import type { WireEnvironment } from './payload';

const BROWSER_MATCHERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: 'Opera', pattern: /OPR\/([\d.]+)/ },
  { name: 'Chrome', pattern: /Chrome\/([\d.]+)/ },
  { name: 'Firefox', pattern: /Firefox\/([\d.]+)/ },
  { name: 'Safari', pattern: /Version\/([\d.]+).*Safari/ },
];

function detectBrowser(userAgent: string): { name?: string; version?: string } {
  for (const { name, pattern } of BROWSER_MATCHERS) {
    const match = pattern.exec(userAgent);
    if (match) return { name, version: match[1] };
  }

  return {};
}

export function collectEnvironment(): WireEnvironment | undefined {
  if (typeof window === 'undefined') return undefined;

  const { name, version } = detectBrowser(navigator.userAgent);

  return {
    UtcOffset: -new Date().getTimezoneOffset() / 60,
    'Browser-Width': window.innerWidth,
    'Browser-Height': window.innerHeight,
    'Screen-Width': screen.width,
    'Screen-Height': screen.height,
    'Color-Depth': screen.colorDepth,
    Browser: navigator.userAgent,
    'Browser-Name': name,
    'Browser-Version': version,
    Platform: navigator.platform,
  };
}
