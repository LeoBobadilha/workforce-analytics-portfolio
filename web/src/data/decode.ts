import { monthOfDay, parseIsoDay, parseYm } from '../lib/dates';
import type { Appraisal, Contract, Employee, Model, Separation, Surge, Vacancy } from './types';

interface Encoded {
  columns: string[];
  dicts: Record<string, string[]>;
  rows: (string | number | null)[][];
}

interface RawModel {
  meta: Model['meta'];
  countries: Model['countries'];
  employees: Encoded;
  contracts: Encoded;
  separations: Encoded;
  vacancies: Encoded;
  surges: Encoded;
  appraisals: Encoded;
}

/** Decode the column-oriented, dictionary-encoded tables produced by pipeline/build_model.py. */
export function decodeTable<T>(e: Encoded): T[] {
  const { columns, dicts, rows } = e;
  const lookups = columns.map((c) => dicts[c]);
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const v = r[i];
      const dict = lookups[i];
      o[columns[i]] = dict && v != null ? dict[v as number] : v;
    }
    return o as T;
  });
}

export function decodeModel(raw: RawModel): Model {
  const employees = decodeTable<Employee>(raw.employees);
  const employeeById = new Map(employees.map((e) => [e.employee_id, e]));
  const contracts = decodeTable<Contract>(raw.contracts).map((c) => {
    c.emp = employeeById.get(c.employee_id)!;
    c.endN = c.end_date ?? Number.POSITIVE_INFINITY;
    return c;
  });
  const simStartDay = parseIsoDay(raw.meta.sim_start);
  const dataEndDay = parseIsoDay(raw.meta.data_end);
  return {
    meta: raw.meta,
    countries: raw.countries,
    employees,
    employeeById,
    contracts,
    separations: decodeTable<Separation>(raw.separations),
    vacancies: decodeTable<Vacancy>(raw.vacancies),
    surges: decodeTable<Surge>(raw.surges),
    appraisals: decodeTable<Appraisal>(raw.appraisals),
    simStartDay,
    dataEndDay,
    minMonth: parseYm(raw.meta.report_start.slice(0, 7)),
    maxMonth: monthOfDay(dataEndDay),
  };
}
