# Exploration Playbook

A repeatable order for building a repository map when the layout is unfamiliar.
Start with the common order, then follow the section for the ecosystem you
detect. Everything here is read-only inspection; read configuration before
considering whether to run any read-only command.

## Common order for any repository

1. Read the root `README`, `AGENTS.md`, and any `CONTRIBUTING` guidance.
2. Read the nearest applicable repository and path-scoped instructions.
3. List the top-level directories to form a first structural hypothesis.
4. Identify the primary language and package manager from manifest files.
5. Find the declared build, test, and lint tasks before inferring commands.
6. Locate entry points named in manifests or task definitions.
7. Skim the test directory to learn intended behavior and conventions.
8. Follow imports outward from an entry point to map dependency direction.

## Detecting the ecosystem

Identify the stack from the manifest and lockfiles present, then use the matching
section below. A repository may combine several; explore each relevant stack.

## JavaScript and TypeScript

* Manifests: `package.json`; lockfiles `package-lock.json`, `pnpm-lock.yaml`,
  `yarn.lock`, `bun.lockb`.
* Commands: read the `scripts` block for build, test, lint, and start tasks.
* Entry points: `main`, `module`, `exports`, or `bin` in `package.json`, and any
  framework config such as a bundler or app-router directory.
* Structure and tests: `src/` with `*.test.*` or `*.spec.*`, or a `test/` tree.

## Python

* Manifests: `pyproject.toml`, `setup.cfg`, `setup.py`, `requirements*.txt`.
* Commands: task runners in `pyproject.toml`, `tox.ini`, `noxfile.py`, `Makefile`.
* Entry points: `project.scripts` or `console_scripts`, `__main__.py`, or an app
  factory referenced by a framework.
* Tests: `tests/` with `test_*.py`, and `pytest`/`unittest` configuration.

## Go

* Manifests: `go.mod` and `go.sum`.
* Commands: `go build ./...`, `go test ./...`, `go vet`, plus any `Makefile`.
* Entry points: `main` packages under `cmd/` or at the module root.
* Tests: `*_test.go` colocated with the code they cover.

## Rust

* Manifests: `Cargo.toml` and `Cargo.lock`; workspaces list member crates.
* Commands: `cargo build`, `cargo test`, `cargo clippy`, `cargo fmt`.
* Entry points: `src/main.rs`, `src/lib.rs`, and `[[bin]]` targets.
* Tests: `#[test]` units, `tests/` integration tests, and doc tests.

## JVM

* Manifests: Maven `pom.xml`, or Gradle `build.gradle` and `settings.gradle`.
* Commands: `mvn` or `gradle` build, test, and check tasks.
* Entry points: a `main` method or a framework application class.
* Tests: `src/test/` with the project's test framework.

## Polyglot and monorepos

* Look for a workspace manifest or a top-level task runner such as `Makefile`,
  `Taskfile`, `justfile`, or a monorepo tool configuration.
* Treat each package or service as its own unit and apply the matching section.
* Map cross-package dependencies from the workspace manifest before diving in.

## Containers and CI as a source of truth

When local commands are unclear, read `Dockerfile`, compose files, and CI
workflow definitions. They encode the canonical build, test, and lint steps and
often reveal entry points, required services, and environment expectations.
