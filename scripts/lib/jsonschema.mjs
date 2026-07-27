// Minimal, dependency-free JSON Schema validator covering the subset used by
// this repository's schemas: type, const, enum, required, additionalProperties,
// properties, maxProperties, items, pattern, minLength, minimum, maximum, and integer. It is
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

function resolveLocalReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((current, segment) => {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return current?.[key];
  }, rootSchema);
}

export function validateAgainstSchema(schema, value, path = '$', errors = [], rootSchema = schema) {
  if (schema.$ref) {
    const resolved = resolveLocalReference(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`${path}: unresolved schema reference ${schema.$ref}.`);
      return errors;
    }
    return validateAgainstSchema(resolved, value, path, errors, rootSchema);
  }

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
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: string longer than maxLength ${schema.maxLength}.`);
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
    if (typeof schema.maxProperties === 'number'
        && Object.keys(value).length > schema.maxProperties) {
      errors.push(`${path}: object has more than maxProperties ${schema.maxProperties}.`);
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        errors.push(`${path}: missing required property "${required}".`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, propValue] of Object.entries(value)) {
      if (key in properties) {
        validateAgainstSchema(properties[key], propValue, `${path}.${key}`, errors, rootSchema);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unknown property "${key}".`);
      } else if (typeof schema.additionalProperties === 'object') {
        validateAgainstSchema(schema.additionalProperties, propValue, `${path}.${key}`, errors, rootSchema);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: array has fewer than minItems ${schema.minItems}.`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: array has more than maxItems ${schema.maxItems}.`);
    }
    value.forEach((item, index) => {
      validateAgainstSchema(schema.items, item, `${path}[${index}]`, errors, rootSchema);
    });
  }

  return errors;
}
