const FIRST_PERSON_PATTERN = /(^|\s)(i['’](?:ll|m|ve|d)|we|we['’]ll|my|our)(\s|[.,!?'’]|$)/i;
const SENTENCE_LEADING_I_PATTERN = /(?:^|[.!?]\s+|\n\s*)I(?=\s|[.,!?]|$)/;
const FIRST_PERSON_OBJECT_PATTERN = /(^|\s)us(\s|[.,!?'’]|$)/;
const SECOND_PERSON_PATTERN = /(^|\s)(you|your|you['’](?:ll|re))(\s|[.,!?'’]|$)/i;

export function usesFirstOrSecondPerson(value) {
  return FIRST_PERSON_PATTERN.test(value)
    || SENTENCE_LEADING_I_PATTERN.test(value)
    || FIRST_PERSON_OBJECT_PATTERN.test(value)
    || SECOND_PERSON_PATTERN.test(value);
}
