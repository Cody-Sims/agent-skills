// Minimal, dependency-free JSON Schema validator covering the subset used by
// this repository's schemas: type, const, enum, required, additionalProperties,
// properties, items, pattern, minLength, minimum, maximum, and integer. It is
// not a general-purpose validator; it exists so generated artifacts can be
// checked against a committed schema without adding npm dependencies.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'integer') return actual === 'integer';
  return actual === type;
}

export function validateAgainstSchema(schema, value, path = '$', errors = []) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected type ${types.join(' | ')}, got ${typeOf(value)}.`);
      return errors;
    }
  }

  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: expected constant ${JSON.stringify(schema.const)}.`);
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not in enum.`);
  }

  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: string does not match pattern ${schema.pattern}.`);
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}.`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: number below minimum ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: number above maximum ${schema.maximum}.`);
    }
  }

  if (typeOf(value) === 'object') {
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        errors.push(`${path}: missing required property "${required}".`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, propValue] of Object.entries(value)) {
      if (key in properties) {
        validateAgainstSchema(properties[key], propValue, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unknown property "${key}".`);
      } else if (typeof schema.additionalProperties === 'object') {
        validateAgainstSchema(schema.additionalProperties, propValue, `${path}.${key}`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      validateAgainstSchema(schema.items, item, `${path}[${index}]`, errors);
    });
  }

  return errors;
}
