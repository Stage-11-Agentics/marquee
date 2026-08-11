MRQ-22 completion handoff

Final exact HEAD: 43a1f4785c3af7514f2793a5e09eb8ce9acbb71a
Base: forgejo/master @ f8e824dc5baeb09e45d25b7b05f2cb3abc1caa4a
PR: https://forgejo.stage11.ai/atin/marquee/pulls/27

The public agenda, session/speaker permalinks, published-only leak boundary,
Amendment 14 venue privacy, anonymous filtered embeds, copyable snippet/live
preview, generated API manifest/OpenAPI paths, 30-second logical cache, and
explicit purge seam are implemented. The AC-86 test asserts both status and
absence of unpublished ID/title/abstract markers.

Required final gate result:

{"command":"pr-gate","ticket":"MRQ-22","status":"pass","elapsedMs":17189}

Gate detail: 161 Vitest tests and 32 contract checks passed; worker, client,
and test types, production build, design contract, and merged AC trace all
passed. Final trace reported zero uncovered criteria and zero errors.

Final-head seeded local Worker evidence: agenda 200 in 37.694ms; embed 200 in
18.621ms with `Cache-Control: public, max-age=30, s-maxage=30`; guessed
permalink 404 in 8.560ms with no marker leakage. Exact self-review and
validation artifacts are attached; self-review verdict PASS with no findings.

