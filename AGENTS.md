# APLC Agent Rules

- Before any `git push` or `gh push`, run `npm run validate:push` from the repo root.
- Do not push if `npm run validate:push` fails.
- If validation is blocked by missing local tooling, install what is needed when safe, then rerun validation before pushing.
- Treat the local pre-push hook in `.githooks/pre-push` as mandatory, not optional.