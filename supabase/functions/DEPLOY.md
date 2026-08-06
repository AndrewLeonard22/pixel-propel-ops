# Deploying the two credential proxies

These two functions exist so that **no credential is ever stored where the browser can
read it.** Before this, `airtableToken` and `anthropicApiKey` lived in the `app_settings`
row — a table any anonymous visitor could `SELECT`, using a key that ships in the public
bundle. The functions hold the secrets instead; the browser asks them.

| function | secret it reads | used by |
|---|---|---|
| `airtable-proxy` | `AIRTABLE_TOKEN` | appointments (`fetchAirtableData`) |
| `anthropic-proxy` | `ANTHROPIC_API_KEY` | the AI chat panel |

Each is **one self-contained file with zero imports.** No shared modules, no build step,
no local toolchain — which is why the dashboard path below works.

---

## ⛔ FIRST: THIS LADDER TESTS THE FUNCTION, NOT THE FEATURE

**Steps 1 and 2 can both report `ok` while the dashboard still shows no appointments,**
and that is not a contradiction — it means the *client* is not calling the proxy yet.

```
step 1  is the function deployed?          ← tests the FUNCTION
step 2  does it have its secret?           ← tests the FUNCTION
step 3  does the APP actually use it?      ← tests the FEATURE   ⬅ DO NOT SKIP
```

At the time of writing, `fetchAirtableData` in `src/lib/dataService.ts` **throws
unconditionally before it ever reaches the proxy** (verified absent from both
`origin/stabilization` and `origin/anvil/stab`). Until that wiring lands, **setting the
secret changes nothing a user can see.** If you do step 2 and the page stays dark, the
deploy did not fail — step 3 is simply not done.

*A function answering `ok` to `curl` proves the code is live. It does not prove anyone
calls it.*

---

## The verification ladder — for steps 1 and 2

Every failure state **names itself**, so you can check each step independently instead of
trusting that it worked. This is the whole point: a deploy that cannot report its own
state is a stamp, not a proof.

| what you get back | what it means | what to do |
|---|---|---|
| HTTP **404** | the function is not deployed | do step 1 |
| **503** `not_configured`<br>*"AIRTABLE_TOKEN is not set on this deployment."* | deployed ✅, secret missing | do step 2 |
| **`auth_failed`** | deployed ✅, secret set ✅, but the token is wrong, expired, or revoked | re-check the token you pasted; after a rotation this is the expected first answer |
| **`unreachable`** / **`vendor_error`** | ours is fine, the vendor is not | not your problem — check Airtable's status |
| **200** `{"status":"ok", ...}` | working | done |

⚠️ **`records: []` is only ever returned under `status: "ok"`.** An empty list always means
a genuinely empty table, never a failure. That property is what stops a dead source from
rendering as "zero appointments".

---

## Step 1 — deploy the functions

### Path A: the dashboard (no CLI needed)

Supabase's dashboard has an Edge Functions section with an editor. Create a function named
exactly `airtable-proxy`, paste the entire contents of `airtable-proxy/index.ts`, deploy.
Repeat for `anthropic-proxy`.

The name must match exactly — the client calls `/functions/v1/airtable-proxy`.

### Path B: the CLI

```sh
supabase functions deploy airtable-proxy
supabase functions deploy anthropic-proxy
```

### Verify step 1

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$VITE_SUPABASE_URL/functions/v1/airtable-proxy" \
  -H 'Content-Type: application/json' -d '{"baseId":"x","tableName":"y"}'
```

`404` → not deployed. Anything else → deployed. **`503` here is success for this step**:
it means the function ran and told you the secret is missing, which is step 2.

---

## Step 2 — set the secrets

### Path A: the dashboard

Edge Functions → Secrets. Add `AIRTABLE_TOKEN` and `ANTHROPIC_API_KEY`.

### Path B: the CLI

```sh
supabase secrets set AIRTABLE_TOKEN=...
supabase secrets set ANTHROPIC_API_KEY=...
```

### Verify step 2

```sh
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/airtable-proxy" \
  -H 'Content-Type: application/json' \
  -d '{"baseId":"<real base id>","tableName":"Appointments"}' | head -c 200
```

- `"status":"not_configured"` → the secret did not take
- `"status":"auth_failed"` → the secret took, but the token is not valid
- `"status":"ok"` → working

⚠️ **Do not paste a token into a shell that logs history, and never echo one back.**

---

## Step 3 — check the APP, not the function

**Steps 1 and 2 passing is not the finish line.** Open the dashboard and look at the
appointments column.

| what the app shows | what it means |
|---|---|
| `—` with *"Appointments (Airtable) — could not load"* | the client called the proxy and it failed — read the message, it names which state |
| `—` with *"not connected. Missing: Airtable base ID."* | config, not deployment — fill in the base ID |
| `—` and **no message changed at all** after step 2 | ⬅ **the client is not calling the proxy.** `fetchAirtableData` still throws before reaching it. Nothing you do in the Supabase dashboard will fix this; it needs the code wiring. |
| real appointment numbers | done — the feature works, not just the function |

⚠️ **The third row is the one this document exists to stop you chasing.** Re-setting a
secret that is already correct, over and over, because the page never changes, is the
predictable failure of verifying a deployment at the wrong layer.

---

## Rotation

Both tokens were readable from the public `app_settings` row and **must be treated as
compromised**. Rotate them at Airtable and Anthropic, then repeat step 2 with the new
values. **Nothing else changes** — no schema change, no code change, no redeploy of the
app. That is deliberate: a rotated key drops in by setting one secret.

Expect `auth_failed` briefly between revoking the old key and setting the new one. That is
the correct answer, not a bug — it is the state naming itself.

---

## What not to do

- **Do not put either credential back into the `app_settings` row.** The migration
  (`20260806000000_lock_down_app_settings.sql`) refuses a non-empty `airtableToken` or
  `anthropicApiKey` and tells you to come here instead.
- **Do not add a `VITE_`-prefixed credential.** Vite compiles those into the browser
  bundle; it would be exactly as exposed as the settings row was.
- **Do not make a failure return `[]`.** Every `fail()` here uses a non-2xx code on
  purpose. An empty array that means "broken" is the bug this whole change exists to kill.

---

## Provenance

**Verified at source:** both files complete and self-contained · zero imports · the exact
secret names above · the status ladder · that `records: []` is emitted only under `ok`.

**Not verified:** the exact click path in the Supabase dashboard. Written from the
function's own contract, not from a screenshot of your console — if the UI disagrees with
Path A, trust the UI and the CLI commands still apply.

**Corrected after first publication:** the original version of this file had steps 1 and 2
only, so its ladder would have reported complete success while the dashboard stayed dark —
a runbook that verifies the deployment at the wrong layer, in a document whose whole claim
was that every state names itself. Step 3 exists because a function answering `ok` to
`curl` proves the code is live and proves nothing about whether the product uses it.
