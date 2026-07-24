# Dead-Code Evidence

Removing code is safe only when you can prove nothing uses it. Collect evidence
from three angles before deleting: references, the call graph, and tests. Treat
any single angle as insufficient on its own.

## Contents

- Reference evidence
- Call-graph evidence
- Dynamic and indirect access
- Public API boundaries
- Test evidence
- Safe removal procedure

## Reference evidence

1. Search the entire repository for the symbol name, not just the directory you
   are working in. Include tests, fixtures, configuration, build scripts, and
   documentation.
2. Search for partial and namespaced forms: a method may be reached through an
   alias, a re-export, or a qualified name.
3. Account for string references. Names used in serialization, routing tables,
   dependency-injection keys, or configuration files will not appear in a
   symbol search and must be searched as strings.
4. If the language has an unused-symbol linter or compiler warning, run it, but
   do not rely on it alone; it usually cannot see dynamic access.

## Call-graph evidence

1. Trace who calls the function or constructs the type. If a static analyzer,
   language server, or reachability tool is available, use it.
2. Follow calls through interfaces, abstract methods, and overrides. An
   implementation can be reached through a base type even when no caller names
   it directly.
3. Confirm the code is not an entry point invoked by a framework, a scheduler, a
   lifecycle hook, or a test runner by convention.
4. Code reachable only from other dead code is also dead; remove it together,
   but prove the whole cluster is unreachable.

## Dynamic and indirect access

These reach code without a visible reference. Rule them out explicitly:

- Reflection, metaprogramming, and name-based lookup.
- Serialization and deserialization that instantiates types by name.
- Plugin registries, service locators, and dependency injection by key.
- Configuration or data files that name handlers, routes, or classes.
- Event names, message types, and callbacks resolved at runtime.

If any of these could reference the symbol, treat it as live until proven
otherwise.

## Public API boundaries

1. Determine whether the symbol is exported from a package or module consumed
   outside this repository.
2. Removing a public export is a breaking change even if this repository has no
   internal callers. It requires a deprecation and version policy, not a silent
   delete.
3. When in doubt about external use, deprecate and announce before removing.

## Test evidence

1. Remove the code, then run the full test suite and the build, not just a
   focused subset. Dead code sometimes has tests; delete those with it.
2. A green run after removal is confirming evidence, but only alongside the
   reference and call-graph checks, since tests may not cover every path.
3. If coverage of the surrounding area is weak, add a characterization test for
   nearby live behavior before removing, so an accidental over-deletion surfaces.

## Safe removal procedure

1. Gather reference, call-graph, and dynamic-access evidence.
2. Confirm the symbol is not a public API, or follow the deprecation path.
3. Remove the code and its dedicated tests in a commit separate from any
   behavior change.
4. Run the full suite and build.
5. Review the diff to confirm only unused code was removed.
