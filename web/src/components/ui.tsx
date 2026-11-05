import { ArrowDownRight, ArrowUpRight, Info, Minus, SearchX, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}>{children}</section>
  );
}

export function InfoTip({ text, label = 'How is this calculated?' }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="grid h-5 w-5 place-items-center rounded-full text-faint transition-colors hover:bg-line-2 hover:text-muted"
      >
        <Info size={14} strokeWidth={2} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute right-0 top-6 z-30 w-72 rounded-lg border border-line bg-white p-3 text-left text-xs font-normal leading-relaxed text-ink-2 shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export interface Delta {
  value: number | null;
  text: string;
  /** whether an increase is good (green), bad (red) or neutral */
  polarity?: 'up-good' | 'up-bad' | 'neutral';
  caption: string;
}

export function DeltaBadge({ d }: { d: Delta }) {
  if (d.value == null) return <span className="text-xs text-faint">{d.caption}</span>;
  const up = d.value > 0;
  const flat = Math.abs(d.value) < 1e-9;
  const pol = d.polarity ?? 'up-good';
  const good = pol === 'neutral' || flat ? null : (up && pol === 'up-good') || (!up && pol === 'up-bad');
  const tone = good == null ? 'text-muted bg-line-2' : good ? 'text-good bg-[#e7f4ec]' : 'text-bad bg-[#fbeaed]';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular ${tone}`}>
        <Icon size={13} strokeWidth={2.5} aria-hidden />
        {d.text}
      </span>
      <span className="text-muted">{d.caption}</span>
    </span>
  );
}

export function Sparkline({ values, color = '#168A80' }: { values: (number | null)[]; color?: string }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2 || v.every((x) => x === 0)) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const w = 96;
  const h = 28;
  const pts = values
    .map((x, i) => (x == null ? null : [(i / (values.length - 1)) * w, h - 3 - ((x - min) / (max - min || 1)) * (h - 6)]))
    .filter((p): p is number[] => p != null);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

interface KpiProps {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  delta?: Delta;
  info: ReactNode;
  spark?: (number | null)[];
  tone?: 'teal' | 'burgundy';
}

export function KpiCard({ icon: Icon, label, value, unit, sub, delta, info, spark, tone = 'teal' }: KpiProps) {
  const toneCls = tone === 'teal' ? 'bg-teal-50 text-teal' : 'bg-burgundy-50 text-burgundy';
  return (
    <Card className="flex min-h-[148px] flex-col p-4 fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-8 w-8 flex-none place-items-center rounded-lg ${toneCls}`}>
            <Icon size={17} strokeWidth={2} aria-hidden />
          </span>
          <h3 className="text-[13px] font-medium leading-tight text-ink-2">{label}</h3>
        </div>
        <InfoTip text={info} label={`How is ${label} calculated?`} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="text-[28px] font-semibold leading-none tracking-tight text-ink">
          {value}
          {unit && <span className="ml-1 text-base font-medium text-muted">{unit}</span>}
        </p>
        {spark && <Sparkline values={spark} color={tone === 'teal' ? '#168A80' : '#934D71'} />}
      </div>
      <div className="mt-auto space-y-1 pt-3">
        {delta && <DeltaBadge d={delta} />}
        {sub && <p className="text-xs leading-snug text-muted">{sub}</p>}
      </div>
    </Card>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  empty?: boolean;
}

export function ChartCard({ title, subtitle, info, actions, children, className = '', footer, empty }: ChartCardProps) {
  return (
    <Card className={`flex min-w-0 flex-col p-5 fade-in ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {info && <InfoTip text={info} label={`About ${title}`} />}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="min-h-0 min-w-0 flex-1">{empty ? <EmptyState /> : children}</div>
      {footer && <footer className="mt-3 border-t border-line-2 pt-3 text-xs text-muted">{footer}</footer>}
    </Card>
  );
}

export function EmptyState({ message = 'No records match the selected filters.' }: { message?: string }) {
  return (
    <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-line bg-page/50 p-6 text-center">
      <div>
        <SearchX className="mx-auto mb-2 text-faint" size={28} aria-hidden />
        <p className="text-sm font-medium text-ink-2">Nothing to show</p>
        <p className="mt-1 max-w-xs text-xs text-muted">{message} Try widening the period or clearing a filter.</p>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-page p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-white text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** HTML legend with values, used beside donuts (identity never relies on colour alone). */
export function ValueLegend({ items }: { items: { name: string; color: string; value: string; share?: string }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.name} className="flex items-center gap-2 text-[13px]">
          <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: it.color }} aria-hidden />
          <span className="flex-1 text-ink-2">{it.name}</span>
          <span className="font-semibold tabular text-ink">{it.value}</span>
          {it.share && <span className="w-12 text-right text-xs tabular text-muted">{it.share}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info'; children: ReactNode }) {
  const cls = {
    good: 'bg-[#e7f4ec] text-good',
    warn: 'bg-[#fdf3e3] text-warn',
    bad: 'bg-[#fbeaed] text-bad',
    neutral: 'bg-line-2 text-muted',
    info: 'bg-teal-50 text-teal-600',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function StatRow({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg bg-page px-3 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">{i.value}</dd>
          {i.hint && <dd className="text-[11px] text-muted">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
