MRQ-36 validation evidence
Base: forgejo/master 3463fbf0f20e103d63cfe1994cd513c031f3103b
HEAD: d4e973f680f6ca10d93954593d6801c498f836f8
Rebase: rebased onto forgejo/master; npm ci completed before validation.
Observed runtime proof: disposable local wrangler dev with a real scoped bearer token passed token route, event seed/show path, accepted submissions list, overdue tasks, and agenda export.
Required command:
npm run pr-gate -- --ticket MRQ-36
Result: PASS
pr-gate JSON: {"command":"pr-gate","ticket":"MRQ-36","status":"pass","elapsedMs":16425,"budgetMs":45000}
Included checks: worker/client/test types, production build, design contract, hermetic tests (16 Vitest files/72 tests; 32 Node files/180 tests; hermetic true), merged AC trace (live 212, test files 71, claims 38, uncovered 0, errors 0).
Warnings: build/test reported missing optional local secrets; they were nonfatal and no secret values were exposed.
AC-145 remains pending the external clean-agent oracle; no local pass is claimed.