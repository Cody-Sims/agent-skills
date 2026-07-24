# Threat Checklist

Concrete questions to ask while reviewing each entry point and asset. Use it to
turn the STRIDE categories in the main workflow into specific probes. Not every
item applies to every change; skip those that are irrelevant.

## Spoofing and Authentication

* Is authentication required on every protected route, including new ones added by
  the change?
* Are tokens and session identifiers verified server-side on each request, not
  trusted from client-supplied claims?
* Do sessions and tokens expire and rotate? Is logout effective server-side?
* Are password and secret comparisons constant-time where timing leaks matter?
* Can an unauthenticated caller reach any function that assumes a caller identity?

## Tampering and Integrity

* Can request parameters, hidden fields, or identifiers be modified to change the
  target of an operation?
* Are integrity-sensitive values signed or validated rather than trusted as sent?
* Can a client set fields that should be server-controlled, such as role, price,
  or owner?
* Are file uploads validated for type, size, and content, and stored outside
  executable paths?

## Repudiation and Logging

* Are security-relevant actions logged with enough context to attribute them?
* Do logs avoid recording secrets, tokens, full card numbers, or personal data?
* Can a user erase or forge their own audit trail?

## Information Disclosure

* Do error messages and stack traces avoid leaking internal detail to clients?
* Do responses return only the fields the caller is authorized to see?
* Could one tenant or user read another's data through an identifier they control?
* Are directory listings, debug endpoints, and verbose modes disabled in
  production paths?

## Denial of Service

* Can a single request trigger unbounded work, allocation, or recursion?
* Are request bodies, uploads, and collections size-limited?
* Are external calls bounded by timeouts and retries with backoff?
* Can pattern matching on user input backtrack catastrophically?

## Elevation of Privilege and Authorization

* Does each protected object access verify that the principal owns or may act on
  that specific object, not merely that they are authenticated?
* Are role and permission checks enforced server-side on every path, including
  administrative and batch operations?
* Can horizontal movement reach a peer's resources, or vertical movement reach a
  higher role?
* Do indirect references, such as sequential identifiers, expose objects the
  caller should not see?

## Injection

* **SQL and query** — Is every query parameterized? Is any clause built by
  concatenating untrusted input?
* **Command** — Is any shell command constructed from input? Prefer argument
  arrays over a shell string; avoid the shell entirely when possible.
* **Path** — Is any file path derived from input canonicalized and confined to an
  allowed base directory to prevent traversal?
* **Template and expression** — Is untrusted input rendered by a template or
  expression engine that can execute code?
* **Output encoding** — Is data encoded for its destination context, such as HTML,
  URL, or shell, at the point of use?

## Deserialization and Untrusted Data

* Is untrusted data deserialized into arbitrary or polymorphic types?
* Are formats that permit code execution or object instantiation avoided for
  external input?
* Is external and inter-service data validated against a strict schema before use?

## SSRF and Outbound Requests

* Are outbound request destinations restricted to an allowlist?
* Are internal and link-local address ranges blocked, including via DNS?
* Are redirects followed only within allowed destinations?

## Cryptography

* Are current, authenticated algorithms used through a vetted library?
* Are keys, salts, and nonces generated from a cryptographic random source and
  never hard-coded or reused?
* Is sensitive data encrypted in transit and, where required, at rest?

## Agent and Prompt Injection

* Is content from users, files, web pages, or tool output treated as data rather
  than as trusted instructions?
* Can external content cause an agent to run tools, reveal secrets, or ignore its
  policy? Are tool permissions and outbound actions constrained accordingly?
* Are model outputs validated before they drive privileged or irreversible actions?
