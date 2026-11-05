import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeModel } from '../data/decode';
import type { Category } from '../data/types';
import { parseYm } from './dates';
import { activeAt, computeKpis, period, type Kpis } from './metrics';

const root = resolve(__dirname, '../../..');
const model = decodeModel(JSON.parse(readFileSync(resolve(root, 'web/public/data/hr_model.json'), 'utf-8')));
const reference = JSON.parse(readFileSync(resolve(root, 'data/processed/reference_kpis.json'), 'utf-8')) as Record<
  string,
  { filters: { from_month: string; to_month: string; country: string | null; category: Category | null }; kpis: Kpis }
>;

describe('TypeScript KPI engine matches the Python reference implementation', () => {
  for (const [name, { filters, kpis }] of Object.entries(reference)) {
    it(name, () => {
      const f = {
        from: parseYm(filters.from_month),
        to: parseYm(filters.to_month),
        country: filters.country,
        category: filters.category,
      };
      const got = computeKpis(model, f);
      for (const [k, expected] of Object.entries(kpis)) {
        const actual = got[k as keyof Kpis];
        if (expected === null) expect(actual, k).toBeNull();
        else expect(actual as number, k).toBeCloseTo(expected as number, 6);
      }
    });
  }
});

describe('model invariants', () => {
  it('one active contract per employee at every month-end', () => {
    for (let mi = model.minMonth; mi <= model.maxMonth; mi++) {
      const { D } = period(model, { from: mi, to: mi, country: null, category: null });
      const a = activeAt(model, D, { country: null, category: null });
      expect(new Set(a.map((c) => c.employee_id)).size).toBe(a.length);
    }
  });

  it('filters partition the workforce without double counting', () => {
    const f = { from: model.minMonth, to: model.maxMonth, country: null, category: null };
    const total = computeKpis(model, f).headcount;
    const cats: Category[] = ['National Staff', 'International Staff', 'Global non-HQ Staff', 'HQ Staff'];
    const sum = cats.reduce((s, category) => s + computeKpis(model, { ...f, category }).headcount, 0);
    expect(sum).toBe(total);
  });
});
