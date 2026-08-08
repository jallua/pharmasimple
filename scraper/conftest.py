"""Pytest bootstrap for the scraper test-suite.

Ensures the ``pharma_scraper`` package is importable no matter which working
directory pytest is launched from (e.g. ``python -m pytest scraper/tests`` run
from the repository root).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
