/**
 * Model-facing tool definitions. Only model arguments appear here; the envelope (tenant, conversation, caller id,
 * versions, turn evidence) is added by the runtime and the gateway and can never be supplied by the model (§9.1).
 * The gateway re-validates every argument with its own strict schemas.
 */
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, e?: string[]) => ({ type: 'string', description, ...(e ? { enum: e } : {}) });

export const TOOL_SPECS = [
  { name: 'get_business_facts', description: "Look up an approved answer about the business (hours, address, payment, services, policies). Returns status answer | no_answer | conflict.",
    input_schema: obj({ question: str("the caller's question"), question_other_language: str('the same question in the other language: Thai if the caller asked in English, English if in Thai (answers may be stored in either)') }, ['question']) },
  { name: 'get_client_context', description: "What is known about the caller from their phone number (preferred name, whether they have future bookings).",
    input_schema: obj({}, []) },
  { name: 'search_availability', description: "Find bookable times. Pass the service as named on the menu and the caller's own date/time words.",
    input_schema: obj({ variant_ref: str('service, e.g. "นวดไทย 60" or "thai massage 60"'), date_phrase: str("the caller's own words for the day/time, unconverted"),
      staff_ref: str('optional staff name the caller asked for'), for_booking_ref: str('only when moving an existing booking') }, ['variant_ref', 'date_phrase']) },
  { name: 'hold_slot', description: 'Hold the time the caller chose. The runtime then reads the exact confirmation sentence to the caller.',
    input_schema: obj({ slot_token: str('slot_token from search_availability'), client_name: str("the caller's name"), for_booking_ref: str('only when moving an existing booking') }, ['slot_token']) },
  { name: 'release_hold', description: 'Release a hold the caller no longer wants.', input_schema: obj({ hold_ref: str('hold_ref') }, ['hold_ref']) },
  { name: 'create_booking', description: 'Book the held time. Only after the caller said yes to the confirmation sentence.',
    input_schema: obj({ hold_ref: str('hold_ref'), client_name: str('the same name given to hold_slot'), send_confirmation_text: { type: 'boolean', description: 'true only if the caller agreed to a text' } }, ['hold_ref', 'client_name']) },
  { name: 'get_bookings_for_caller', description: "The caller's own future bookings (only for a verified caller).", input_schema: obj({}, []) },
  { name: 'reschedule_booking', description: 'Move a booking to the held time, after the caller said yes to the confirmation sentence.',
    input_schema: obj({ booking_ref: str('booking_ref'), hold_ref: str('hold_ref'), send_confirmation_text: { type: 'boolean', description: 'true only if the caller agreed to a text' } }, ['booking_ref', 'hold_ref']) },
  { name: 'cancel_booking', description: 'Cancel a booking. Call first with confirmed=false (the runtime reads the cancellation sentence with any fee), then with confirmed=true after the caller says yes.',
    input_schema: obj({ booking_ref: str('booking_ref'), confirmed: { type: 'boolean', description: 'false to read the confirmation; true after the yes' }, send_confirmation_text: { type: 'boolean', description: 'true only if the caller agreed to a text' } }, ['booking_ref', 'confirmed']) },
  { name: 'record_consent', description: "Record the caller's permission to be texted about their pending question (request_owner_answer records it itself after the caller's yes).",
    input_schema: obj({ purpose: str('always service_followup', ['service_followup']), target: str('ani = the number they are calling from', ['ani', 'other_number']),
      number: str('only for other_number'), question_text: str('the confirmed one-sentence question') }, ['purpose', 'target', 'question_text']) },
  { name: 'request_owner_answer', description: 'Send the caller\'s question to the team; they will text the answer. The first call reads the question back and asks permission to text; after the caller says yes, call it again with the same question_text.',
    input_schema: obj({ question_text: str('the same confirmed sentence'), summary_source: str('model if you wrote the sentence', ['model', 'caller_words']),
      reply_target: obj({ kind: str('ani or other_number', ['ani', 'other_number']), number: str('only for other_number') }, ['kind']),
      caller_preferred_name: str("caller's name if given"), variant_ref: str('service the question is about, if any') }, ['question_text', 'summary_source', 'reply_target']) },
  { name: 'request_human_transfer', description: 'Try to connect the caller to a person.',
    input_schema: obj({ reason: str('why', ['caller_asked', 'unknown_question', 'sensitive', 'frustration', 'tool_failure']), topic: str('a few words') }, ['reason', 'topic']) },
  { name: 'log_booking_request', description: 'When bookings cannot be confirmed now, pass a request to the team (not a booking).',
    input_schema: obj({ variant_ref: str('service'), date_phrase: str("caller's words"), client_name: str("caller's name") }, ['variant_ref', 'date_phrase']) },
];

/**
 * Checks a model's tool arguments against the model-facing schema above. Claude's strict tool use guarantees the
 * shape; open models served by Ollama or an OpenAI-compatible host do not, so the runtime checks every call itself and
 * hands a fault back to the model instead of running the tool. Returns the problems found (none = valid).
 */
export function checkArgs(name: string, input: unknown): string[] {
  const spec = TOOL_SPECS.find(t => t.name === name);
  if (!spec) return [`unknown tool ${name}`];
  return checkValue(spec.input_schema, input, 'arguments');
}

function checkValue(schema: any, v: unknown, at: string): string[] {
  if (schema.type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return [`${at} must be an object`];
    const o = v as Record<string, unknown>, out: string[] = [];
    for (const k of schema.required ?? []) if (o[k] === undefined || o[k] === null) out.push(`${at}.${k} is required`);
    for (const [k, val] of Object.entries(o)) {
      if (!(k in schema.properties)) { if (schema.additionalProperties === false) out.push(`${at}.${k} is not a known field`); continue; }
      if (val === undefined || (val === null && !(schema.required ?? []).includes(k))) continue;
      out.push(...checkValue(schema.properties[k], val, `${at}.${k}`));
    }
    return out;
  }
  if (schema.type === 'string') {
    if (typeof v !== 'string') return [`${at} must be a string`];
    if (schema.enum && !schema.enum.includes(v)) return [`${at} must be one of ${schema.enum.join(', ')}`];
    return [];
  }
  if (schema.type === 'boolean') return typeof v === 'boolean' ? [] : [`${at} must be true or false`];
  return [];
}
