#!/usr/bin/env node
// finprodata MCP server — verified, never-stale finance-professional data
// for AI agents. Open source (MIT); a pure API client with no database
// access. Auth: set FINPRODATA_API_KEY (and optionally FINPRODATA_BASE_URL).
//
// Tool descriptions are product copy for agents: they state explicitly
// what is free (searching) and what consumes credits (get_contact), so
// autonomous loops budget correctly.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Finprodata, FinprodataError } from "@finprodata/sdk";

const apiKey = process.env.FINPRODATA_API_KEY;
if (!apiKey) {
  console.error("FINPRODATA_API_KEY is required");
  process.exit(1);
}

const client = new Finprodata({
  apiKey,
  baseUrl: process.env.FINPRODATA_BASE_URL,
});

const server = new McpServer({
  name: "finprodata",
  version: "0.1.0",
});

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof FinprodataError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: err.status, title: err.title, ...err.detail }),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: String(err) }],
  };
}

server.registerTool(
  "search_firms",
  {
    description:
      "Search investment firms (RIAs, PE/VC fund sponsors, broker-dealers) from SEC/FINRA registry data. " +
      "FREE — does not consume contact credits. Every focus tag carries source, last_verified_at, and confidence. " +
      "investor_type values: private_equity, venture_capital, hedge_fund, family_office, search_fund, ria_wealth, and more.",
    inputSchema: {
      q: z.string().optional().describe("Firm name search"),
      state: z.string().length(2).optional().describe("2-letter US state"),
      org_type: z.enum(["ria", "era", "broker_dealer", "fund_sponsor", "unregistered"]).optional(),
      investor_type: z.string().optional().describe("Filter by investing focus, e.g. private_equity, venture_capital, family_office"),
      sector: z.string().optional().describe("Strategy sector, e.g. software, healthcare_services, business_services"),
      stage: z.string().optional().describe("e.g. lower_middle_market, middle_market, seed, growth_equity"),
      geography: z.string().optional().describe("e.g. us_southwest, us_national"),
      aum_min: z.number().optional(),
      aum_max: z.number().optional(),
      offering_min: z.number().optional().describe("Min Form D raise size USD — small values find long-tail funds"),
      offering_max: z.number().optional().describe("Max Form D raise size USD"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
  },
  async (args) => {
    try {
      return jsonResult(
        await client.searchFirms({
          q: args.q,
          state: args.state,
          orgType: args.org_type,
          focusInvestorType: args.investor_type,
          focusSector: args.sector,
          focusStage: args.stage,
          focusGeography: args.geography,
          aumMin: args.aum_min,
          aumMax: args.aum_max,
          offeringMin: args.offering_min,
          offeringMax: args.offering_max,
          limit: args.limit,
          cursor: args.cursor,
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "get_firm",
  {
    description:
      "Get one firm by its finprodata UUID or by SEC CRD number (pass 'crd:123456'). FREE.",
    inputSchema: { id: z.string().describe("Firm UUID or crd:<number>") },
  },
  async (args) => {
    try {
      return jsonResult(await client.getFirm(args.id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "search_people",
  {
    description:
      "Search finance professionals (fund partners, executives, advisers) with registry-verified employment. " +
      "FREE. Contact details are MASKED in results — freshness/status are visible, values require get_contact (which costs credits).",
    inputSchema: {
      q: z.string().optional().describe("Person name search"),
      firm_id: z.string().uuid().optional(),
      title: z.string().optional().describe('Title filter, e.g. "MANAGING PARTNER". NOTE: registry data names signers/officers only; for full rosters incl. associates, the operator must run a PDL roster pull.'),
      firm_state: z.string().length(2).optional().describe("People AT firms in this state"),
      firm_investor_type: z.string().optional().describe("People AT firms with this focus, e.g. venture_capital — one query for 'partners at TX VC firms'"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
  },
  async (args) => {
    try {
      return jsonResult(
        await client.searchPeople({
          q: args.q,
          firmId: args.firm_id,
          title: args.title,
          firmState: args.firm_state,
          firmInvestorType: args.firm_investor_type,
          limit: args.limit,
          cursor: args.cursor,
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "identify_people",
  {
    description:
      "Resolve names to verified people records — USE THIS FIRST when matching leads. Batch up to 50 names in ONE call " +
      "(never loop one-by-one). Per query the SERVER decides: match_found false means the person is not in the data — " +
      "STOP, do not invent a record. auto_match true means the top candidate is unambiguous and safe to use. " +
      "Otherwise pick from candidates[] using firm/state/title differentiators, or report the ambiguity. " +
      "Every candidate carries data_age_days (registry freshness) and total_matches is the true count. FREE.",
    inputSchema: {
      queries: z
        .array(
          z.object({
            name: z.string().describe("Person's name"),
            firm: z.string().optional().describe("Firm name, sharpens disambiguation a lot"),
            state: z.string().length(2).optional(),
            title: z.string().optional(),
          }),
        )
        .min(1)
        .max(50),
    },
  },
  async (args) => {
    try {
      return jsonResult(await client.identifyPeople(args.queries));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "get_contact",
  {
    description:
      "Reveal a person's verified email. COSTS 1 CREDIT unless served from the verification cache " +
      "(repeat reveals within 90 days are FREE and report units_spent: 0). " +
      "Check get_usage before bulk reveals. The response includes verification status, provenance, " +
      "and whether the record earns the 'verified' badge (deliverable email + registry-confirmed employment within 90 days).",
    inputSchema: {
      person_id: z.string().uuid(),
      max_age_days: z.number().int().min(1).max(365).optional()
        .describe("Treat cached emails older than this as stale (default 90)"),
    },
  },
  async (args) => {
    try {
      return jsonResult(await client.revealContact(args.person_id, { maxAgeDays: args.max_age_days }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "export_smartlead_csv",
  {
    description:
      "Export ALREADY-REVEALED contacts as a Smartlead-ready CSV. Never triggers new enrichment (no surprise spend). " +
      "Returns CSV text with first_name,last_name,email,company,title,linkedin_url,custom_email_status,custom_last_verified.",
    inputSchema: {
      person_ids: z.array(z.string().uuid()).min(1).max(1000),
    },
  },
  async (args) => {
    try {
      const csv = await client.exportSmartleadCsv(args.person_ids);
      return { content: [{ type: "text" as const, text: csv }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "search_allocators",
  {
    description:
      "Search capital allocators (LPs): pension funds, endowments, foundations, family offices, and investment funds. " +
      "FREE. Filter by type (pension_plans|family_office|endowment_foundation|private_equity|venture_capital|hedge_fund|angel), " +
      "state, AUM range, and client_base (the LP profile of RIAs: pension_plans|high_net_worth|pooled_funds). " +
      "Returns AUM, contact counts, and how many manager relationships each has.",
    inputSchema: {
      q: z.string().optional(),
      type: z.string().optional(),
      state: z.string().length(2).optional(),
      client_base: z.string().optional(),
      aum_min: z.number().optional(),
      aum_max: z.number().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async (args) => {
    try {
      return jsonResult(await client.searchAllocators({
        q: args.q, type: args.type, state: args.state, clientBase: args.client_base,
        aumMin: args.aum_min, aumMax: args.aum_max, limit: args.limit,
      }));
    } catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  "get_network",
  {
    description:
      "Get the connection graph around a firm or person as {nodes, edges} — who works where, which funds a firm advises, " +
      "and which LPs invest in which managers (from Form 5500 Schedule C). Use to map an investor's network or trace " +
      "LP→GP relationships. FREE. Pass kind ('firm' or 'person') and the entity's UUID.",
    inputSchema: {
      kind: z.enum(["firm", "person"]),
      id: z.string().uuid(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async (args) => {
    try { return jsonResult(await client.network(args.kind, args.id, args.limit)); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  "get_usage",
  {
    description:
      "Check this API key's usage for the current month (by cost class) and remaining units if capped. " +
      "FREE. Call this before spending credits on reveals.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await client.usage());
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("finprodata mcp server running (stdio)");
