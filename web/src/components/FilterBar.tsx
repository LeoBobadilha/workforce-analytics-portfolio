import { CalendarRange, Earth, RotateCcw, SlidersHorizontal, UsersRound, X } from 'lucide-react';
import { CATEGORIES, type Category } from '../data/types';
import { fmtMonth, monthYear, range } from '../lib/dates';
import { useApp } from '../state/AppData';

const selectCls =
  'select h-9 rounded-lg border border-line bg-white pl-3 text-sm text-ink hover:border-[#c8d1dc] focus:border-teal focus:outline-none';

export function FilterBar() {
  const { model, filters, setFilters, resetFilters, isFiltered, labels } = useApp();
  const months = range(model.minMonth, model.maxMonth);
  const max = model.maxMonth;
  const { y: maxY } = monthYear(max);

  const presets: { id: string; label: string; from: number; to: number }[] = [
    { id: 'all', label: 'Full period', from: model.minMonth, to: max },
    { id: 'l12', label: 'Last 12 months', from: max - 11, to: max },
    { id: 'ytd', label: `${maxY} year to date`, from: maxY * 12, to: max },
    ...[maxY - 1, maxY - 2]
      .filter((y) => y * 12 >= model.minMonth)
      .map((y) => ({ id: String(y), label: `Calendar year ${y}`, from: y * 12, to: y * 12 + 11 })),
  ];
  const current = presets.find((p) => p.from === filters.from && p.to === filters.to)?.id ?? 'custom';
  const countries = [...model.countries].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="z-30 -mx-1 rounded-xl md:sticky md:top-[60px] border border-line bg-white/95 p-3 shadow-[var(--shadow-card)] backdrop-blur lg:top-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 hidden items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted 2xl:inline-flex">
          <SlidersHorizontal size={14} aria-hidden /> Filters
        </span>

        <label className="flex items-center gap-1.5">
          <CalendarRange size={15} className="text-faint" aria-hidden />
          <span className="sr-only">Period preset</span>
          <select
            className={`${selectCls} w-[178px]`}
            value={current}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value);
              if (p) setFilters({ from: p.from, to: p.to });
            }}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {current === 'custom' && <option value="custom">Custom range</option>}
          </select>
        </label>

        <div className="flex items-center gap-1.5">
          <label>
            <span className="sr-only">From month</span>
            <select className={`${selectCls} w-[118px]`} value={filters.from} onChange={(e) => setFilters({ from: Number(e.target.value) })}>
              {months.map((m) => (
                <option key={m} value={m} disabled={m > filters.to}>
                  {fmtMonth(m)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-faint">to</span>
          <label>
            <span className="sr-only">To month</span>
            <select className={`${selectCls} w-[118px]`} value={filters.to} onChange={(e) => setFilters({ to: Number(e.target.value) })}>
              {months.map((m) => (
                <option key={m} value={m} disabled={m < filters.from}>
                  {fmtMonth(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <span className="mx-1 hidden h-6 w-px bg-line md:block" aria-hidden />

        <label className="flex items-center gap-1.5">
          <Earth size={15} className="text-faint" aria-hidden />
          <span className="sr-only">Country</span>
          <select
            className={`${selectCls} w-[206px]`}
            value={filters.country ?? ''}
            onChange={(e) => setFilters({ country: e.target.value || null })}
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name === model.meta.hq_country ? `${c.name} (HQ)` : c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <UsersRound size={15} className="text-faint" aria-hidden />
          <span className="sr-only">Staff category</span>
          <select
            className={`${selectCls} w-[192px]`}
            value={filters.category ?? ''}
            onChange={(e) => setFilters({ category: (e.target.value || null) as Category | null })}
          >
            <option value="">All staff categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={resetFilters}
          disabled={!isFiltered}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-2 transition-colors hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={14} aria-hidden /> Clear filters
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line-2 pt-2 text-xs text-muted">
        <span>
          Showing <b className="font-semibold text-ink-2">{labels.period}</b> · stocks measured on <b className="font-semibold text-ink-2">{labels.asOf}</b>
          {labels.prevYear ? <> · compared with {labels.prevYear}</> : null}
        </span>
        {filters.country && (
          <Chip onClear={() => setFilters({ country: null })}>Country: {filters.country}</Chip>
        )}
        {filters.category && <Chip onClear={() => setFilters({ category: null })}>Category: {filters.category}</Chip>}
      </div>
    </div>
  );
}

function Chip({ children, onClear }: { children: string[] | string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-0.5 pl-2.5 pr-1 font-medium text-teal-600">
      {children}
      <button type="button" onClick={onClear} aria-label={`Remove filter ${[children].flat().join('')}`} className="rounded-full p-0.5 hover:bg-teal-100">
        <X size={12} />
      </button>
    </span>
  );
}
