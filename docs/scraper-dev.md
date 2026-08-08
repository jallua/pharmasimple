# Scraper local dev environment

The scraper (`scraper/`) targets **Python `>=3.11,<3.14`** (see `scraper/pyproject.toml`)
and CI runs it on Linux + Python 3.13. On a machine that only has Python 3.14
(unsupported by the pinned native deps `lxml`/`scrapling`), provision a compatible
interpreter with [`uv`](https://docs.astral.sh/uv/) — no system install required,
and `scraper/.venv` is gitignored:

```sh
# one-time: compatible interpreter + locked deps
uv python install 3.13
uv venv --python 3.13 scraper/.venv
uv pip install --python scraper/.venv/Scripts/python.exe -r scraper/requirements.lock
```

## Running the tests

```sh
scraper/.venv/Scripts/python -m pytest scraper --basetemp=D:/q -q
```

**Windows note:** the content-addressed evidence store uses 64-hex directory and
file names. Under the default temp dir those paths exceed the Windows `MAX_PATH`
(260) limit, so a few `evidence`/`quarantine` tests fail with `FileNotFoundError`.
Pass a short `--basetemp` (e.g. `D:/q`) — or enable Win32 long paths — to run them.
These are **Windows-only path-length artifacts, not code bugs** (CI on Linux is green).

## Running the pipeline

```sh
# fail-closed: a record is promoted only when >=2 independent official sources reconcile
scraper/.venv/Scripts/python scraper/refresh.py --mode incremental
node scripts/import-verified-content.ts --apply
```

On Windows, point the staging/output base at a short path to stay under `MAX_PATH`.
