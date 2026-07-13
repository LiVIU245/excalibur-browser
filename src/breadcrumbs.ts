import type { WireBreadcrumb } from './payload';

export type BreadcrumbLevel = 'debug' | 'info' | 'warning' | 'error';

export interface Breadcrumb {
  message: string;
  level?: BreadcrumbLevel;
  type?: string;
  timestamp?: number;
}

export class BreadcrumbBuffer {
  private crumbs: Breadcrumb[] = [];

  constructor(private readonly limit: number = 32) {}

  record(crumb: Breadcrumb): void {
    this.crumbs.push({ timestamp: Date.now(), ...crumb });
    if (this.crumbs.length > this.limit) {
      this.crumbs.splice(0, this.crumbs.length - this.limit);
    }
  }

  snapshot(): WireBreadcrumb[] {
    return this.crumbs.map((crumb) => ({
      level: crumb.level ?? 'info',
      timestamp: crumb.timestamp,
      type: crumb.type ?? 'manual',
      message: crumb.message,
    }));
  }

  clear(): void {
    this.crumbs = [];
  }
}
