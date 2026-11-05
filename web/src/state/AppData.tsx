import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { decodeModel } from '../data/decode';
import type { DataQuality, Model } from '../data/types';
import { fmtDay, fmtMonth, monthEndDay } from '../lib/dates';
import { period, type Filters, type Period } from '../lib/metrics';

interface Ctx {
  model: Model;
  dq: DataQuality;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  isFiltered: boolean;
  p: Period;
  labels: { period: string; asOf: string; prevYear: string | null; asOfMonth: string };
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

const base = import.meta.env.BASE_URL;

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ model: Model; dq: DataQuality } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setF] = useState<Filters | null>(null);

  useEffect(() => {
    Promise.all([fetch(`${base}data/hr_model.json`).then((r) => r.json()), fetch(`${base}data/data_quality.json`).then((r) => r.json())])
      .then(([raw, dq]) => {
        const model = decodeModel(raw);
        setState({ model, dq });
        setF(defaults(model));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!state || !filters) return null;
    const { model } = state;
    const p = period(model, filters);
    const def = defaults(model);
    return {
      ...state,
      filters,
      setFilters: (f) => setF((old) => normalise(model, { ...(old as Filters), ...f })),
      resetFilters: () => setF(def),
      isFiltered:
        filters.from !== def.from || filters.to !== def.to || filters.country != null || filters.category != null,
      p,
      labels: {
        period: filters.from === filters.to ? fmtMonth(filters.from) : `${fmtMonth(filters.from)} – ${fmtMonth(filters.to)}`,
        asOf: fmtDay(p.D),
        asOfMonth: fmtMonth(filters.to),
        prevYear: p.prevD != null ? fmtDay(monthEndDay(filters.to - 12)) : null,
      },
    };
  }, [state, filters]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">The dataset could not be loaded.</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal border-t-transparent" aria-hidden />
          Loading synthetic HR dataset…
        </div>
      </div>
    );
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function defaults(m: Model): Filters {
  return { from: m.minMonth, to: m.maxMonth, country: null, category: null };
}

function normalise(m: Model, f: Filters): Filters {
  let from = Math.max(m.minMonth, Math.min(m.maxMonth, f.from));
  let to = Math.max(m.minMonth, Math.min(m.maxMonth, f.to));
  if (from > to) [from, to] = [to, from];
  return { ...f, from, to };
}
