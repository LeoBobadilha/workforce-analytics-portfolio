import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  /** value used for sorting and search */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  width?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  caption: string;
}

export function DataTable<T>({ rows, columns, rowKey, pageSize = 10, initialSort, searchPlaceholder = 'Search…', toolbar, caption }: Props<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (needle) {
      out = rows.filter((r) => columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        out = [...out].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
        });
      }
    }
    return out;
  }, [rows, columns, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * pageSize, cur * pageSize + pageSize);

  const toggle = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search {caption}</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-teal focus:outline-none"
          />
        </label>
        {toolbar}
        <span className="ml-auto text-xs text-muted tabular">
          {filtered.length.toLocaleString('en-GB')} {filtered.length === 1 ? 'record' : 'records'}
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState message="No rows match the search or filters." />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="bg-page text-left">
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const Icon = active ? (sort!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      style={{ width: c.width }}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`whitespace-nowrap border-b border-line px-2.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted ${
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                      }`}
                    >
                      {c.sortable === false ? (
                        c.header
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggle(c.key)}
                          className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? 'text-ink' : ''}`}
                        >
                          {c.header}
                          <Icon size={12} aria-hidden className={active ? 'text-teal' : 'text-faint'} />
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={rowKey(r)} className="border-b border-line-2 last:border-0 hover:bg-teal-50/40">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap px-2.5 py-2.5 text-[13px] text-ink-2 ${
                        c.align === 'right' ? 'text-right tabular' : c.align === 'center' ? 'text-center' : ''
                      }`}
                    >
                      {c.render ? c.render(r) : (c.value(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-end gap-2 text-xs text-muted" aria-label={`${caption} pagination`}>
          <span className="tabular">
            Page {cur + 1} of {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage(cur - 1)}
            disabled={cur === 0}
            aria-label="Previous page"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white hover:border-teal disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => setPage(cur + 1)}
            disabled={cur >= pages - 1}
            aria-label="Next page"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white hover:border-teal disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </nav>
      )}
    </div>
  );
}
