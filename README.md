# PharmaSimple

PharmaSimple is a statically generated drug-mechanism reference site backed by a provenance-aware scraper. Published content is informational and is not medical advice.

## Local verification

```powershell
npm ci
npm test
npm run check
npm run validate
npm run build

python -m pip install -r scraper/requirements.txt
python -m pytest scraper/tests
```

Node.js 24 and Python 3.13 match CI. The final repository layout places the scraper at `scraper/` and the site package at the Git root.

## Delivery and security

Pull requests must pass Node, Python, content, build, dependency-review, npm-audit, and pip-audit gates. Merges to `main` repeat the gates and deploy a commit-SHA-named immutable GitHub Pages artifact. Scheduled refreshes use one idempotent `automation/scraper-refresh` PR.

See [the operations and rollback runbook](docs/operations.md) and [the security policy](SECURITY.md).
