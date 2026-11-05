export type Category = 'National Staff' | 'International Staff' | 'Global non-HQ Staff' | 'HQ Staff';

export const CATEGORIES: Category[] = ['National Staff', 'International Staff', 'Global non-HQ Staff', 'HQ Staff'];

export interface Employee {
  employee_id: string;
  gender: string | null;
  birth_date: number | null;
  nationality: string | null;
  nationality_group: 'Global North' | 'Global South' | 'Not recorded';
  first_hire_date: number;
  latest_hire_date: number;
}

export interface Contract {
  contract_id: string;
  employee_id: string;
  start_date: number;
  end_date: number | null;
  planned_end_date: number | null;
  contract_type: 'Open-Ended' | 'Fixed-Term' | 'Short-Term';
  staff_category: Category;
  country: string;
  grade: string;
  department: string;
  position_title: string;
  start_reason: string;
  end_reason: string | null;
  /** derived */
  emp: Employee;
  endN: number;
}

export interface Separation {
  employee_id: string;
  exit_date: number;
  exit_type: 'Voluntary' | 'Involuntary';
  exit_reason: string;
  staff_category: Category;
  country: string;
  grade: string;
  department: string;
}

export interface Vacancy {
  vacancy_id: string;
  source: string;
  country: string;
  staff_category: Category;
  grade: string;
  department: string;
  position_title: string;
  position_type: 'New Position' | 'Replacement';
  opened_date: number;
  planned_close_date: number;
  closed_date: number | null;
  status: 'Open' | 'Closed';
  outcome: string | null;
  candidate_type: string | null;
  hired_employee_id: string | null;
  applicants: number;
  shortlisted: number;
  interviewed: number;
  offers: number;
  dq_valid: number;
  time_to_done_hours: number | null;
}

export interface Surge {
  surge_id: string;
  source: string;
  country: string;
  request_date: number;
  status: 'Filled' | 'Cancelled' | 'Open';
  role: string;
  deployed_employee_id: string | null;
  deployed_category: Category | null;
  home_country: string | null;
  start_date: number | null;
  end_date: number | null;
}

export interface Appraisal {
  employee_id: string;
  appraisal_date: number;
  appraisal_type: string;
}

export interface CountryRef {
  name: string;
  iso3: string;
  region: string;
}

export interface Meta {
  title: string;
  synthetic: boolean;
  seed: number;
  sim_start: string;
  report_start: string;
  data_end: string;
  generated_at: string;
  hq_country: string;
}

export interface Model {
  meta: Meta;
  countries: CountryRef[];
  employees: Employee[];
  employeeById: Map<string, Employee>;
  contracts: Contract[];
  separations: Separation[];
  vacancies: Vacancy[];
  surges: Surge[];
  appraisals: Appraisal[];
  simStartDay: number;
  dataEndDay: number;
  minMonth: number;
  maxMonth: number;
}

export interface DQRule {
  rule_id: string;
  source: string;
  description: string;
  records_checked: number;
  issues_found: number;
  records_merged: number;
  action: string;
  status: 'Pass' | 'Resolved' | 'Warning' | 'Merged';
  dimension: string;
}

export interface DataQuality {
  generated_at: string;
  overall_completeness: number;
  raw_completeness: number;
  issues_total: number;
  issues_resolved: number;
  issues_open: number;
  records_merged: number;
  rules_total: number;
  rules_passed: number;
  sources: { source: string; completeness: number; issues: number; rules: number }[];
  completeness_by_field: { source: string; field: string; completeness: number; records: number }[];
  rules: DQRule[];
  lineage: { entity: string; source: string; records: number }[];
  reconciliation: {
    headcount_cells: number;
    headcount_matched: number;
    expat_cells: number;
    expat_matched: number;
    sample_differences: { tracker: string; month: string; country: string; tracker_value: number; model_value: number }[];
  };
}
