// finprodata SDK — typed client for the finprodata REST API.
// Open source (MIT). The API itself requires an API key (fpd_live_*).
//
//   const client = new Finprodata({ apiKey: process.env.FINPRODATA_API_KEY });
//   const firms = await client.searchFirms({ state: "TX", focusInvestorType: "private_equity" });
//
// Every provenance-bearing field arrives as
// { value, source, source_ref, last_verified_at, confidence } — freshness
// is in-band so callers (human or agent) can judge it before acting.

export interface Provenanced<T> {
  value: T;
  source: string;
  source_ref?: string | null;
  last_verified_at: string;
  confidence: number;
}

export interface FocusTag {
  dimension: "sector" | "stage" | "check_size" | "geography" | "investor_type";
  value: string;
  source: string;
  last_verified_at: string;
  confidence: number;
}

export interface Firm {
  id: string;
  crd_number: number | null;
  name: string;
  org_type: string;
  city: string | null;
  state: string | null;
  aum: number | null;
  website: string | null;
  focus_tags: FocusTag[];
}

export interface PersonEmployment {
  firm_id: string;
  firm_name: string;
  title: Provenanced<string | null>;
}

export interface ContactPresence {
  channel: string;
  available: boolean;
  status: string;
  last_verified_at: string;
}

export interface Person {
  id: string;
  crd_number: number | null;
  full_name: string;
  linkedin_url: string | null;
  employments: PersonEmployment[];
  contacts: ContactPresence[];
}

export interface Page<T> {
  data: T[];
  /** True result-set size — trust this, never count visible rows. */
  total_matches: number;
  next_cursor: string | null;
}

export interface IdentifyQuery {
  name: string;
  firm?: string;
  state?: string;
  title?: string;
}

export interface IdentifyCandidate {
  person_id: string;
  full_name: string;
  crd_number: number | null;
  firm_name: string | null;
  firm_state: string | null;
  title: string | null;
  confidence: number;
  data_age_days: number | null;
}

export interface IdentifyResult {
  query: IdentifyQuery;
  /** false = no acceptable match exists; STOP, do not invent one. */
  match_found: boolean;
  /** true = the server judged the top candidate unambiguous. */
  auto_match: boolean;
  total_matches: number;
  best: IdentifyCandidate | null;
  candidates: IdentifyCandidate[];
}

export interface RevealResponse {
  person_id: string;
  cached: boolean;
  verified: boolean;
  reason: string | null;
  email: {
    value: string;
    status: string;
    source: string;
    last_verified_at: string;
    confidence: number;
  } | null;
  units_spent: number;
}

export interface UsageSummary {
  period: string;
  by_cost_class: Record<string, number>;
  total_units: number;
  monthly_unit_cap: number | null;
  units_remaining: number | null;
}

export class FinprodataError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: Record<string, unknown>,
  ) {
    super(`${status}: ${title}`);
    this.name = "FinprodataError";
  }
  get retryAfterSeconds(): number | null {
    const v = this.detail["retry_after"];
    return typeof v === "number" ? v : null;
  }
}

export interface FinprodataOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class Finprodata {
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(opts: FinprodataOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://finprodata.vercel.app").replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/v1${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await this.fetchFn(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let detail: Record<string, unknown> = {};
      try {
        detail = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON error body
      }
      throw new FinprodataError(
        res.status,
        typeof detail["title"] === "string" ? (detail["title"] as string) : res.statusText,
        detail,
      );
    }
    if (opts.raw) return (await res.text()) as unknown as T;
    return (await res.json()) as T;
  }

  searchFirms(params: {
    q?: string;
    state?: string;
    orgType?: string;
    focusInvestorType?: string;
    focusSector?: string;
    focusStage?: string;
    focusGeography?: string;
    aumMin?: number;
    aumMax?: number;
    /** Form D raise size — the long-tail sizing signal */
    offeringMin?: number;
    offeringMax?: number;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Page<Firm>> {
    return this.request("GET", "/firms", {
      query: {
        q: params.q,
        state: params.state,
        org_type: params.orgType,
        "focus.investor_type": params.focusInvestorType,
        "focus.sector": params.focusSector,
        "focus.stage": params.focusStage,
        "focus.geography": params.focusGeography,
        aum_min: params.aumMin,
        aum_max: params.aumMax,
        offering_min: params.offeringMin,
        offering_max: params.offeringMax,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
  }

  getFirm(idOrCrd: string): Promise<Firm> {
    return this.request("GET", `/firms/${encodeURIComponent(idOrCrd)}`);
  }

  searchPeople(params: {
    q?: string;
    firmId?: string;
    title?: string;
    /** people AT firms in this state */
    firmState?: string;
    /** people AT firms with this investing focus, e.g. venture_capital */
    firmInvestorType?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Page<Person>> {
    return this.request("GET", "/people", {
      query: {
        q: params.q,
        firm_id: params.firmId,
        title: params.title,
        firm_state: params.firmState,
        "firm_focus.investor_type": params.firmInvestorType,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
  }

  /** Costs credits when not served from cache. Check usage() first. */
  revealContact(personId: string, opts: { maxAgeDays?: number } = {}): Promise<RevealResponse> {
    return this.request("POST", `/people/${personId}/reveal`, {
      body: { channels: ["email"], max_age_days: opts.maxAgeDays },
    });
  }

  /** Smartlead-ready CSV of already-revealed contacts. Never enriches. */
  exportSmartleadCsv(personIds: string[]): Promise<string> {
    return this.request("POST", "/exports/csv", {
      body: { person_ids: personIds, format: "smartlead" },
      raw: true,
    });
  }

  /**
   * Batch person resolution (up to 50 queries in ONE call). The server
   * decides match quality: match_found false means stop; auto_match true
   * means the top candidate is safe to use without human review.
   */
  identifyPeople(queries: IdentifyQuery[]): Promise<{ results: IdentifyResult[] }> {
    return this.request("POST", "/people/identify", { body: { queries } });
  }

  /** findLPs-style allocator search: pensions, endowments, family offices, funds. FREE. */
  searchAllocators(params: {
    q?: string;
    type?: string;
    state?: string;
    clientBase?: string;
    aumMin?: number;
    aumMax?: number;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ data: unknown[]; total_matches: number; next_cursor: string | null }> {
    return this.request("GET", "/allocators", {
      query: {
        q: params.q, type: params.type, state: params.state,
        client_base: params.clientBase, aum_min: params.aumMin, aum_max: params.aumMax,
        limit: params.limit, cursor: params.cursor,
      },
    });
  }

  /** Connection graph from a firm or person: {nodes, edges}. FREE. */
  network(kind: "firm" | "person", id: string, limit?: number): Promise<{
    seed: string;
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ source: string; target: string; type: string; label?: string }>;
  }> {
    return this.request("GET", `/network/${kind}/${id}`, { query: { limit } });
  }

  usage(): Promise<UsageSummary> {
    return this.request("GET", "/usage");
  }
}
