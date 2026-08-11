Final exact-head review: cefa26247b07bb4e08a05eba5e46b30448d37e60 against forgejo/master cf7c74b191bc1866f38f42833eb1a81e804f144d.

Verdict: PASS.

The rebase preserved the M-29 implementation and MRQ-29 onboarding/search shell composition. The only post-rebase source adjustment was removing the unnecessary external flag from the /api/docs route-table entry; the Sidebar uses a direct docs anchor, route matching remains covered, and this preserves the existing QuickSearch contract that lists only event-site and portal external routes. Targeted QuickSearch and route-table tests pass.

The original authorization review remains valid at the final content: production bearer rows use the canonical credential resolver, real rows load issuer memberships constrained by person and organization plus the organization event boundary, and tokenHasGrant requires requested grant intersected with effective membership and event allowance. AC-242 tests cover all four absence properties and positive controls. Secret/hash, revocation, event restriction, docs route discovery, same-path method scoping, and no third always_live site were rechecked by the final gate.

No M-54 or AC-241 code is present or claimed; its prerequisite gate remains unmet. No findings remain.