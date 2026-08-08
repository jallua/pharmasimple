# Operations runbook

## Required repository settings

1. Set the default branch to `main` and enable GitHub Pages with **Source: GitHub Actions**.
2. Protect `main`: require pull requests, at least one approving review, CODEOWNERS review, conversation resolution, and the three `Pull request gate` checks. Require branches to be up to date and block force pushes/deletion.
3. Enable private vulnerability reporting, Dependabot alerts/security updates, the dependency graph, and secret scanning with push protection where the plan supports them.
4. Configure the `github-pages` environment. Restrict deployment branches to `main`; optionally require an approval for production.
5. Keep the default `GITHUB_TOKEN` permission read-only in every validation and refresh job. The isolated `publish-pr` job receives a repository-scoped GitHub App token only after the read-only generator succeeds; it never installs dependencies or executes repository code. The deploy job elevates only `pages` and `id-token`.
6. Install a repository-scoped GitHub App with only **Contents: Read and write** and **Pull requests: Read and write**. Store its ID as `CONTENT_REFRESH_APP_ID`, private key as `CONTENT_REFRESH_APP_PRIVATE_KEY`, and exact bot login (normally `<app-slug>[bot]`) as the repository variable `CONTENT_REFRESH_APP_BOT_LOGIN`. This token lets automation-created PRs trigger the normal `pull_request` gates. Do not grant administration, workflows, deployments, or secrets access.


## Pull requests and deployment

Every pull request runs Node tests, Python tests, Astro checks, content validation, a production build, dependency review, `npm audit`, and `pip-audit`. Only a push (or re-run of that push) on `main` can deploy. It repeats those gates, builds `dist`, uploads `github-pages-<commit SHA>`, and deploys that exact artifact. `pip-audit` runs on a separate read-only runner with no access to the Pages artifact. Actions are pinned to commit SHAs; Dependabot proposes Action SHA updates.

Use `publish.ps1 -Paths <path...>` for local publication. It creates or uses a `feature/*` branch, stages only named paths, pushes that explicit branch, and creates or reuses a PR. It never pushes `main`.

## Scheduled content refresh

`Refresh verified content` runs incremental refreshes Sundays at 03:17 UTC and full refreshes on the first day of each month at 04:47 UTC. Manual runs can select either mode. The root `run-scraper.ps1` calls `scraper/refresh.py --mode <mode>` and fails closed if the final scraper entry point is absent or returns nonzero.

Generated data is validated before publication. Python packages install from `scraper/requirements.lock` with `--require-hashes`. The read-only generator uploads a same-run artifact containing only source plan, active facts, import report, and a SHA-256 provenance inventory. A fresh write-enabled runner verifies every digest and path before synchronizing those generated files. PR CI requires the exact configured App bot, verifies the named successful `refresh-content.yml` run through the Actions API, downloads that run's immutable artifact, and compares its complete publishable file set byte-for-byte with the PR. A branch name, generic Bot author type, or PR-authored digest alone grants no trust. Repeated runs update the same PR, and no PR is created when the tree is unchanged. After the initial baseline lands, CI also rejects any change to `src/lib/trust-policy.ts` or `src/data/legacy-lkg.json`, so legacy LKG cannot be rebased in a later PR. Review provenance and medical-content changes before merging.

## Rollback

1. Identify the last known-good deployment and commit SHA in **Actions → Gate and deploy Pages**.
2. Preferred: revert the bad commit through a PR. Merging the revert reruns every gate and deploys a new immutable artifact.
3. Emergency: while the artifact is retained, rerun the known-good workflow run at its original SHA and redeploy its SHA-named artifact. Then follow with a revert PR so `main` matches production.
4. Verify the Pages URL, smoke-test representative pages, and record the failed and restored SHAs in the incident notes.

Artifacts are retained for 30 days. A rollback never edits an existing artifact and never force-pushes `main`.
