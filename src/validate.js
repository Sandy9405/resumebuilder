// Minimal JSON Schema validation for tool inputs.
//
// The tools are not `strict` (the API refuses to compile a grammar that large),
// and inputs stream eagerly, so nothing upstream guarantees their shape. Every
// tool input is checked here before it touches the resume: a missing `bullets`
// array must be an error sent back to the model, never an edit that wipes them.
// Covers what tools.js uses: object/array/string/boolean/integer/number, enum,
// required, items, and additionalProperties:false.

export function validate(schema, value, path = 'input', errors = []) {
  if (errors.length >= 16) return errors;
  const type = schema.type;
  const fail = (msg) => errors.push(`${path} ${msg}`);
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('must be an object'), errors;
    for (const key of schema.required || []) if (!(key in value)) fail(`is missing required field "${key}"`);
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) validate(sub, value[key], `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties || {}))) fail(`has unknown field "${key}"`);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return fail('must be an array'), errors;
    value.forEach((v, i) => validate(schema.items || {}, v, `${path}[${i}]`, errors));
  } else if (type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be true or false');
  } else if (type === 'integer') {
    if (!Number.isInteger(value)) fail('must be an integer');
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a number');
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  return errors;
}
