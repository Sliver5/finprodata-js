# finprodata — SDK + MCP server

Verified, never-stale data on finance professionals: PE/VC investors, fund sponsors, registered advisers, bankers, and brokers, built from SEC and FINRA registry filings and re-verified continuously.

Every field carries provenance:

```json
{ "value": "MANAGING PARTNER", "source": "adv_schedule_ab", "source_ref": "FilingID 2102478", "last_verified_at": "2026-05-01T18:35:00.000Z", "confidence": 1 }
```

"Verified" is computed at read time (deliverable email + registry-confirmed employment within 90 days), so it structurally cannot go stale.

## MCP server (use it from Claude or any MCP client)

```json
{
  "mcpServers": {
    "finprodata": {
      "command": "npx",
      "args": ["tsx", "mcp/src/index.ts"],
      "env": { "FINPRODATA_API_KEY": "fpd_live_..." }
    }
  }
}
```

Tools: `search_firms`, `get_firm`, `search_people` (free), `get_contact` (1 credit, free on cache hits), `export_smartlead_csv`, `get_usage`.

## SDK

```ts
import { Finprodata } from "./sdk/src/index.ts";

const client = new Finprodata({ apiKey: process.env.FINPRODATA_API_KEY! });

const firms = await client.searchFirms({
  state: "TX",
  focusInvestorType: "private_equity",
  aumMin: 100_000_000,
});

const people = await client.searchPeople({ firmId: firms.data[0].id });
const contact = await client.revealContact(people.data[0].id); // costs 1 credit unless cached
```

## Design notes for AI agents

- Searching is free; revealing contacts costs credits. `get_usage` reports remaining units.
- Reveals are idempotent within a 90-day cache window; retries are safe and cached re-reveals bill 0.
- Errors are RFC 7807 problem+json with machine-actionable fields (`retry_after`, `budget_usd`, `suggestion`).
- Rate limiting returns `Retry-After`; back off accordingly.

## API access

API keys are currently provisioned manually. Contact bhopen95@gmail.com.

MIT licensed. The API service and underlying dataset are proprietary.
