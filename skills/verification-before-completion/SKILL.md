---
name: verification-before-completion
description: "Requires fresh evidence before any claim that work is done, fixed, passing, working, complete, or ready. Run the relevant command now, read the actual output and exit status, inspect the produced artifact or diff, reproduce the original symptom and confirm it is gone, and distinguish verified results from assumed ones. Use before reporting completion, closing a task, or telling the user something works, and whenever tests, builds, or lint results are described as passing."
license: MIT
disable-model-invocation: false
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Verification Before Completion

Do not claim work is done, fixed, passing, working, or ready without fresh
evidence gathered now. A plausible expectation is not verification.

## Goal

Replace assumed success with observed success. Every completion claim must rest
on command output, exit status, or an inspected artifact obtained in the current
session.

## When to use

Use this before reporting completion, closing a task, telling the user something
works, or citing tests, a build, or lint results as passing. It applies to your
own work and to any result reported by a subagent.

## Procedure

1. Name the claim you are about to make and the specific evidence that would
   prove it. If you cannot name the evidence, you cannot make the claim.
2. Run the relevant command now. Do not rely on output from an earlier turn, a
   cached result, or a run before your last change.
3. Read the actual output and the exit status. A command that prints text but
   exits non-zero has failed. Do not skim for the word you hoped to see.
4. Inspect the produced artifact or diff when the claim is about a file, build
   output, or change. Confirm it contains what you expect.
5. Reproduce the original symptom and confirm it is gone. Fixing code is not the
   same as fixing the problem; trigger the original failing case and watch it
   pass.
6. Distinguish verified results from assumed ones in your report. State plainly
   what you ran and what you inferred but did not run.
7. Report unresolved and pre-existing failures instead of hiding them. Do not
   narrow a command, skip a case, or alter a test to produce a green result.

## Distinctions that matter

Do not let one kind of evidence stand in for another:

- A build compiling is not the same as tests passing.
- Tests passing is not the same as lint or type checks passing.
- A passing focused test is not the same as a passing full suite.
- Static compilation is not the same as correct runtime behavior.
- A subagent's report is not the same as independently verified state.
- Code that looks correct is not the same as a reproduced symptom that is gone.

## Anti-rationalization

These thoughts are signals to stop and verify, not to proceed:

- It should work now.
- The change is small, so it is fine.
- The test probably still passes.
- It worked earlier, so it still works.
- The subagent said it was done.

Each of these is an assumption. Convert it into a command you run now.

## What counts as evidence

- Command output together with its exit status, produced after the final change.
- A file or diff you opened and read in the current session.
- The original failing case, re-run, now passing.

## Output format

Report:

1. Each claim, and the exact command or inspection that verified it.
2. The actual result, including exit status and any failure.
3. What you verified versus what you assumed.
4. Any unresolved or pre-existing failure, stated openly.
