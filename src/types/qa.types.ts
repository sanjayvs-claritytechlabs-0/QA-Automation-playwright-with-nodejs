export type CaptureFlags = {
  html_snapshot?: boolean;
  screenshot?: boolean;
  meta_description?: boolean;
  page_model?: boolean;
};

export type DiscoverRequest = {
  job_id?: string;
  base_url: string;
  max_depth?: number;
  max_pages?: number;
  browser?: string;
  same_origin?: boolean;
  capture?: CaptureFlags;
};

export type PageModel = {
  forms: Array<{
    name: string | null;
    inputs: Array<{
      label: string | null;
      type: string | null;
      placeholder: string | null;
      required: boolean;
      name: string | null;
    }>;
    buttons: Array<{ text: string | null; role: string | null }>;
  }>;
  buttons: Array<{ text: string | null; role: string | null }>;
  links: Array<{ text: string | null; href: string | null }>;
  dropdowns: Array<{ label: string | null; options: string[] }>;
  checkboxes: Array<{ label: string | null; checked: boolean }>;
  tables: Array<{ headers: string[]; row_count: number }>;
  visible_text: string[];
  labels: string[];
  aria_roles: string[];
  locator_map: unknown[];
};

export type DiscoverPage = {
  url: string;
  title: string;
  meta_description: string | null;
  depth: number;
  status: number;
  html?: string;
  screenshot?: {
    content_type: string;
    encoding: 'base64';
    data: string;
  };
  page_model?: PageModel;
  meta: Record<string, unknown>;
};

export type LocatorsRequest = {
  job_id?: string;
  browser?: string;
  max_per_page?: number;
  pages: Array<{ page_id: string; url: string }>;
};

export type ExtractedLocator = {
  name: string | null;
  strategy: string;
  selector: string;
  role: string | null;
  accessible_name: string | null;
  meta: Record<string, unknown>;
};

export type ExecuteLocator = {
  id?: string;
  strategy: string;
  selector: string;
  role?: string | null;
  accessible_name?: string | null;
};

export type ExecuteStep = {
  ordinal?: number;
  action: string;
  locator?: ExecuteLocator | null;
  value?: string | null;
  description?: string;
};

export type ExecuteAssertion = {
  type: string;
  expected?: string | null;
  locator_id?: string | null;
  locator?: ExecuteLocator | null;
};

export type ExecuteCase = {
  test_case_id: string;
  test_plan_id?: string;
  title?: string;
  steps: ExecuteStep[];
  assertions?: ExecuteAssertion[];
};

export type ExecuteRequest = {
  job_id?: string;
  base_url: string;
  browser?: string;
  capture?: {
    screenshot_on_failure?: boolean;
    video?: boolean;
    trace?: boolean;
  };
  cases: ExecuteCase[];
};
