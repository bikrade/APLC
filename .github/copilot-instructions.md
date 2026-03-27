# Copilot Instructions

For this repository, any request to push changes, including `git push` or `gh push`, requires full local pre-push validation first.

Required process:

1. Run `npm run validate:push` from the repo root.
2. Confirm it passes completely.
3. Only then push changes.

If validation fails, fix the issue and rerun `npm run validate:push` before attempting any push.
If Docker, Buildx, or the local container runtime is missing, treat that as a blocker for pushing unless the user explicitly overrides the requirement.