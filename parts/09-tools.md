## 9. Tool and API contracts

### 9.1 Two layers: what the model fills, and what the server binds

The model sees only **model arguments** (small, typed, `additionalProperties: false`, `strict: true`). The voice
runtime forwards them with the per-call capability token; the **Tool Gateway** builds the **envelope** from the
token and server state. The model can never supply or override an envelope field — if it tries (an argument named
`tenant_id`, say), the schema rejects it.

```json
{
  "$id": "envelope.v1",
  "type": "object", "additionalProperties": false,
  "required": ["tenant_id","actor","conversation_id","requested_action","policy_version","config_version","request_id"],
  "properties": {
    "tenant_id":         {"type":"string","format":"uuid","description":"from capability token only"},
    "location_id":       {"type":"string","format":"uuid"},
    "actor":             {"type":"object","required":["kind","id"],"properties":{
                            "kind":{"enum":["ai_runtime","owner","staff","system"]},"id":{"type":"string"}}},
    "conversation_id":   {"type":"string","format":"uuid"},
    "requested_action":  {"type":"string","description":"tool name + verb, e.g. create_booking"},
    "policy_version":    {"type":"string"},
    "config_version":    {"type":"integer"},
    "request_id":        {"type":"string","description":"trace id"},
    "idempotency_key":   {"type":"string","maxLength":200,"description":"REQUIRED for write tools; derived by gateway"},
    "expected_version":  {"type":"integer","minimum":1,"description":"REQUIRED for writes on existing rows"},
    "confirmed_at":      {"type":"string","format":"date-time","description":"REQUIRED for consequential writes"},
    "confirmation_turn_id": {"type":"string","format":"uuid","description":"turn that followed the rendered confirmation"}
  }
}
```

**Write tools** (`hold_slot`, `release_hold`, `create_booking`, `reschedule_booking`, `cancel_booking`,
`request_owner_answer`, `relay_owner_answer`, `request_human_transfer`, `send_confirmation`, `record_consent`,
`record_opt_out`) require `tenant_id, actor, conversation_id, idempotency_key, expected_version (where a row
exists), policy_version, confirmed_at (consequential ones), requested_action`. Idempotency keys are derived by the
gateway, e.g. `book:{conversation_id}:{hold_id}`; the model never invents them. Same key + different request hash →
`VALIDATION_FAILED`.

### 9.2 Common result and typed errors

```json
{
  "$id": "result.v1", "type":"object", "required":["ok"],
  "properties": {
    "ok": {"type":"boolean"},
    "data": {"type":"object"},
    "error": {"type":"object","required":["code","retryable","speakable_hint"],"properties":{
      "code": {"enum":["NOT_FOUND","AMBIGUOUS","CONFLICT","POLICY_BLOCKED","CONSENT_REQUIRED",
                       "CONNECTOR_UNAVAILABLE","RATE_LIMITED","AUTH_EXPIRED","VALIDATION_FAILED",
                       "HUMAN_REQUIRED","VERSION_MISMATCH","EXPIRED"]},
      "retryable": {"type":"boolean"},
      "speakable_hint": {"enum":["slot_taken","no_availability","need_more_detail","not_allowed_by_policy",
                                 "cannot_text_number","system_trouble","needs_person","try_again","none"]},
      "detail_internal": {"type":"string","description":"never shown to the model"}
    }},
    "provenance": {"type":"array","items":{"type":"object","properties":{
      "source":{"enum":["config","knowledge_article","booking_ledger","connector","policy"]},
      "ref":{"type":"string"},"version":{"type":"string"}}}}
  }
}
```

| Code | Meaning | Retryable | What the conversation does |
|---|---|---|---|
| `NOT_FOUND` | Entity absent in this tenant | no | Ask again / say not found |
| `AMBIGUOUS` | >1 match | no | Ask a disambiguating question (non-sensitive) |
| `CONFLICT` | Slot taken (exclusion constraint / external conflict) | no | SM-4 |
| `VERSION_MISMATCH` | `expected_version` stale | no | Re-read, restate, re-confirm once |
| `POLICY_BLOCKED` | Outside policy (window, horizon, eligibility) | no | Explain from policy record |
| `CONSENT_REQUIRED` | No valid consent / opted out | no | SM-11 rules |
| `CONNECTOR_UNAVAILABLE` | Authority or mirror down | yes (gateway once) | `request_fallback` |
| `RATE_LIMITED` | Abuse or provider limit | after delay | Truthful message |
| `AUTH_EXPIRED` | Capability token or OAuth expired | no | Degraded path; incident if mid-call |
| `VALIDATION_FAILED` | Schema/rule failure | no | Ask again; audit as possible injection if repeated |
| `HUMAN_REQUIRED` | Rule says a person must act | no | SM-9 or staff task |
| `EXPIRED` | Hold or PQ expired | no | Re-search / late path |

### 9.3 Read tools

**T-01 `get_business_facts`**

```json
{"model_args":{"type":"object","additionalProperties":false,"required":["question"],
  "properties":{"question":{"type":"string","maxLength":300},
                "topic_hint":{"enum":["hours","location","parking","services","prices","policies","staff","payment_methods","other"]}}},
 "data":{"type":"object","required":["status"],"properties":{
   "status":{"enum":["answer","no_answer","conflict","restricted"]},
   "facts":{"type":"array","maxItems":3,"items":{"type":"object","required":["text","ref","version","audience"],
     "properties":{"text":{"type":"string"},"ref":{"type":"string"},"version":{"type":"string"},
                   "audience":{"enum":["speakable","messageable"]},"score":{"type":"number"}}}}}}}
```
Server rules: tenant filter and `audience @> {'speakable'}` and effective dates applied **before** vector search;
structured facts (hours, address, prices from `service_variants`) come from config, not from embeddings; two
published facts with different values for one key → `conflict`. Internal notes are never returned.

**T-02 `get_client_context`**

```json
{"model_args":{"type":"object","additionalProperties":false,"properties":{}},
 "data":{"type":"object","properties":{
   "identity_status":{"enum":["verified_ani","unverified","unknown"]},
   "preferred_name":{"type":"string"},
   "has_future_bookings":{"type":"boolean"},
   "language_preference":{"enum":["th","en"]}}}}
```
Takes no model arguments: the caller is identified from the capability token's ANI hash. Returns no notes, no
visit history, no balances in the MVP.

**T-03 `search_availability`**

```json
{"model_args":{"type":"object","additionalProperties":false,"required":["variant_ref","window"],
  "properties":{"variant_ref":{"type":"string","description":"from get_business_facts/services list"},
    "window":{"type":"object","required":["date_phrase"],"properties":{
      "date_phrase":{"type":"string","maxLength":80,"description":"caller's words, e.g. 'Friday afternoon'"},
      "resolved_start":{"type":"string","format":"date-time"},"resolved_end":{"type":"string","format":"date-time"}}},
    "staff_ref":{"type":"string"},"max_options":{"type":"integer","minimum":1,"maximum":3}}},
 "data":{"type":"object","required":["options","resolved_window_local"],"properties":{
   "resolved_window_local":{"type":"string","description":"code-rendered, e.g. 'Fri 14 Nov 2026, 13:00–17:00'"},
   "needs_clarification":{"type":"string","enum":["none","which_friday","am_or_pm","thai_clock_period","date_out_of_horizon"]},
   "options":{"type":"array","maxItems":3,"items":{"type":"object","required":["slot_token","start_local","resource_names"],
     "properties":{"slot_token":{"type":"string","description":"opaque, signed, 10-min validity"},
       "start_local":{"type":"string"},"end_local":{"type":"string"},"resource_names":{"type":"array","items":{"type":"string"}}}}}}}}
```
Server rules: date phrase resolved by code in the location's time zone and relative to the call's start (§11.2);
if the model also sent `resolved_start` and it disagrees with code → code wins and `needs_clarification` is set;
qualification, hours, buffers, blocks, external busy time and active claims are all applied; options are signed
tokens so the model cannot invent a slot.

**T-07 `get_bookings_for_caller`**

```json
{"model_args":{"type":"object","additionalProperties":false,
  "properties":{"stated_date_phrase":{"type":"string","maxLength":80},"stated_name":{"type":"string","maxLength":80}}},
 "data":{"type":"object","required":["match"],"properties":{
   "match":{"enum":["verified","stated_unique","none","ambiguous","unverified"]},
   "bookings":{"type":"array","maxItems":3,"items":{"type":"object","properties":{
     "booking_ref":{"type":"string"},"version":{"type":"integer"},"day_time_local":{"type":"string"},"service_name":{"type":"string"}}}}}}}
```
Returns bookings only for `verified_ani`, or when the stated details match exactly one future booking; otherwise
`unverified` and no data (no enumeration of other people's bookings).

### 9.4 Write tools

**T-04 `hold_slot`** — model args `{slot_token}`; data `{hold_ref, expires_at, rendered_confirmation}`. The
rendered confirmation sentence [CODE+RECORD] is what the model must say verbatim. Errors: `CONFLICT`, `EXPIRED`
(token older than 10 min).

**T-05 `release_hold`** — model args `{hold_ref}`; idempotent; also called by the runtime on hang-up.

**T-06 `create_booking`**

```json
{"model_args":{"type":"object","additionalProperties":false,"required":["hold_ref","client_name"],
  "properties":{"hold_ref":{"type":"string"},"client_name":{"type":"string","maxLength":80},
    "callback_number":{"type":"string","description":"defaults to ANI; E.164 validated"},
    "send_confirmation_text":{"type":"boolean"}}},
 "envelope_required":["idempotency_key","confirmed_at","confirmation_turn_id","policy_version"],
 "data":{"type":"object","required":["booking_ref","version","rendered_summary"],"properties":{
   "booking_ref":{"type":"string"},"version":{"type":"integer"},"rendered_summary":{"type":"string"},
   "confirmation_text_queued":{"type":"boolean"},"owner_notice_queued":{"type":"boolean"}}}}
```
Server: verifies the confirmation turn followed the rendered confirmation from T-04; converts the hold to booking
claims in one transaction (internal authority) or calls the external platform with the idempotency key (§11.6);
booking row + outbox rows commit together. Replay with the same key returns the original result.

**T-08 `reschedule_booking`** — model args `{booking_ref, hold_ref}`; envelope adds `expected_version`,
`confirmed_at`, `confirmation_turn_id`; data `{booking_ref, new_version, rendered_summary_old_new}`; errors
`VERSION_MISMATCH`, `CONFLICT`, `POLICY_BLOCKED`.

**T-09 `cancel_booking`** — model args `{booking_ref}`; envelope as T-08; data `{booking_ref, version,
policy_consequence_text}` (text from policy record); never refunds.

**T-10 `request_owner_answer`**

```json
{"model_args":{"type":"object","additionalProperties":false,"required":["confirmed_question_ref","reply_target","consent_ref"],
  "properties":{"confirmed_question_ref":{"type":"string","description":"from the UQ3 confirmation record (frozen text)"},
    "reply_target":{"type":"object","required":["kind"],"properties":{
      "kind":{"enum":["ani","other_number"]},"number":{"type":"string"}}},
    "consent_ref":{"type":"string","description":"from record_consent"},
    "caller_preferred_name":{"type":"string","maxLength":60},
    "context_line":{"type":"string","maxLength":160}}},
 "envelope_required":["idempotency_key"],
 "data":{"type":"object","required":["pq_handle","expires_at_local","target_last_digits","speakable_expectation"],
   "properties":{"pq_handle":{"type":"string"},"expires_at_local":{"type":"string"},
     "target_last_digits":{"type":"string"},"speakable_expectation":{"type":"string","description":"[CODE] sentence incl. tenant reply-window if configured"},
     "target_verification":{"enum":["ani_match","sms_confirm"]}}}}
```
Errors: `CONSENT_REQUIRED` (no consent / prior STOP), `RATE_LIMITED`, `VALIDATION_FAILED` (question fails safety
re-check), `CONNECTOR_UNAVAILABLE` (DB/outbox) → UQ6 failure line. Idempotency key `pq:{conversation_id}:{question_sha256}`.

**T-11 `relay_owner_answer`** — **not a model tool.** Invoked by the PQ workflow after §5.8.5 validation and owner
Send. Request `{pq_id, owner_reply_id, answer_text_sha256, expected_version}`; data `{delivery_ref, status}`;
errors `CONSENT_REQUIRED`, `EXPIRED`, `VALIDATION_FAILED`. Listed here because the brief requires its contract; it is
deliberately outside the model's tool list so a caller cannot trigger it.

**T-12 `request_human_transfer`** — model args `{reason: enum[caller_asked, unknown_question, sensitive,
frustration, tool_failure], topic: string ≤80}`; data `{eligible: bool, outcome: enum[bridged, no_answer, busy,
declined, machine, failed]}` (returned when SM-9 completes; the runtime pauses the model meanwhile); errors
`HUMAN_REQUIRED` never applies; `POLICY_BLOCKED` when ineligible.

**T-13 `send_confirmation`** — system tool (outbox consumer), not exposed to the model after booking (T-06 queues
it). Request `{booking_ref, channel, template_id, expected_version}`; checks transactional consent rule for the
geography (D-07).

**T-14 `record_consent`** — model args `{purpose: enum[service_followup], target: enum[ani, other_number],
number?: string, utterance_turn_ref: string}`; server writes evidence (turn id, recording offset, text hash);
refuses if `opt_outs` says stopped (`CONSENT_REQUIRED` with hint `cannot_text_number`). The model cannot record
`marketing` or `recording` consent (recording consent is the call machine's).

**T-15 `record_opt_out`** — **not a model tool.** Only the messaging gateway's keyword parser, provider opt-out
events and staff actions call it: `{channel, target_hash, keyword, source_message_id}`.

### 9.5 Tool exposure per state

The runtime only exposes tools valid for the current state of the active sub-machine (e.g. `create_booking` is
absent until a hold exists and the confirmation sentence has been spoken). Exposed set is part of the published
config version and is logged per turn.
