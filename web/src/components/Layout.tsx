import {
  BookOpenText,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Earth,
  FileCheck2,
  LayoutDashboard,
  Menu,
  RefreshCcw,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { FilterBar } from './FilterBar';
import { useApp } from '../state/AppData';

export const REPO_URL = 'https://github.com/LeoBobadilha/workforce-analytics-portfolio';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/leonardobobadilha/';

export const NAV = [
  { to: '/', label: 'Workforce Overview', icon: LayoutDashboard, n: '01' },
  { to: '/profile', label: 'Global Workforce Profile', icon: Earth, n: '02' },
  { to: '/diversity', label: 'Diversity & Mobility', icon: UsersRound, n: '03' },
  { to: '/recruitment', label: 'Recruitment & Vacancies', icon: BriefcaseBusiness, n: '04' },
  { to: '/retention', label: 'Retention & Development', icon: RefreshCcw, n: '05' },
  { to: '/contracts', label: 'Contracts & Data Quality', icon: FileCheck2, n: '06' },
];

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-teal text-white">
        <ChartNoAxesCombined size={19} strokeWidth={2.25} aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-white">Workforce Analytics</p>
        <p className="mt-0.5 text-[11px] font-medium leading-snug text-[#8fd3cb]">
          <span className="whitespace-nowrap">HR Data Integration &amp;</span> <span className="whitespace-nowrap">Business Intelligence</span>
        </p>
      </div>
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboards" className="space-y-1">
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8794]">Dashboards</p>
      {NAV.map(({ to, label, icon: Icon, n }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
              isActive ? 'bg-white/[0.08] text-white' : 'text-[#b6c0ca] hover:bg-white/[0.04] hover:text-white'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[#2fb5a7]" aria-hidden />}
              <Icon size={17} strokeWidth={2} className={isActive ? 'text-[#5fcabd]' : 'text-[#7b8794] group-hover:text-[#b6c0ca]'} aria-hidden />
              <span className="flex-1">{label}</span>
              <span className="text-[10px] tabular text-[#5d6975]">{n}</span>
            </>
          )}
        </NavLink>
      ))}
      <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8794]">Documentation</p>
      <NavLink
        to="/methodology"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
            isActive ? 'bg-white/[0.08] text-white' : 'text-[#b6c0ca] hover:bg-white/[0.04] hover:text-white'
          }`
        }
      >
        <BookOpenText size={17} className="text-[#7b8794]" aria-hidden />
        Methodology & KPIs
      </NavLink>
    </nav>
  );
}

function Disclaimer() {
  const { model } = useApp();
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-[#9aa5b1]">
      <p className="font-semibold text-[#d5dbe1]">Independent portfolio demo</p>
      <p className="mt-1">
        All figures are synthetic (seed {model.meta.seed}) and describe no real organisation, person or staff
        statistic.
      </p>
      <p className="mt-2 border-t border-white/10 pt-2">
        Built by <span className="text-[#d5dbe1]">Leonardo Bobadilha</span> ·{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-medium text-[#8fd3cb] underline-offset-2 hover:underline">
          Source code
        </a>
      </p>
    </div>
  );
}

export function Layout({ title, description, children, actions }: { title: string; description: string; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { labels } = useApp();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = `${title} · Workforce Analytics`;
  }, [loc.pathname, title]);

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[272px] flex-none bg-navy lg:block">
      <aside className="sticky top-0 z-40 flex h-screen w-[272px] flex-col px-4 py-5">
        <div className="px-2">
          <Brand />
        </div>
        <div className="mt-8 flex-1 overflow-y-auto">
          <Nav />
        </div>
        <Disclaimer />
      </aside>
      </div>

      <div className="min-w-0 flex-1">
      {/* mobile top bar + drawer */}
      <div className="sticky top-0 z-40 flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="rounded-lg p-2 text-white hover:bg-white/10">
          <Menu size={20} />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-navy px-4 py-5">
            <div className="flex items-center justify-between px-2">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded-lg p-1.5 text-white hover:bg-white/10">
                <X size={18} />
              </button>
            </div>
            <div className="mt-8 flex-1 overflow-y-auto">
              <Nav onNavigate={() => setOpen(false)} />
            </div>
            <Disclaimer />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1520px] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted">
              Workforce Analytics <span className="text-faint">/</span> {title}
            </p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
              Reporting date <b className="font-semibold text-ink">{labels.asOf}</b>
            </span>
            <span className="inline-flex items-center rounded-lg bg-burgundy-50 px-3 py-1.5 text-xs font-medium text-burgundy">Synthetic data</span>
          </div>
        </header>
        <FilterBar />
        <div className="mt-5 space-y-5">{children}</div>
        <footer className="mt-10 border-t border-line pt-5 text-xs text-muted">
          Workforce Analytics · Independent portfolio demonstration built with synthetic data; no real personal or organisational
          data is used. ·{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-medium text-teal hover:underline">Source code on GitHub</a>
          {' · '}
          <NavLink to="/methodology" className="font-medium text-teal hover:underline">About this project</NavLink>
        </footer>
      </main>
      </div>
    </div>
  );
}
