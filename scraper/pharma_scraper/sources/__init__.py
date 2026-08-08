"""Fail-closed parsers and live adapters for official medicine sources."""
from __future__ import annotations

from .base import (
    AmbiguousResultError, ContentTypeError, DrugNameMismatchError,
    FieldConflictError, HTTPResponse, HTTPStatusError, MissingDocumentIdError,
    NetworkError, OfficialSourceRecord, ParseError, ResponseTooLargeError,
    RobotsDeniedError, SafeHTTPClient, SchemaChangedError, SecurityError, SourceAdapterError,
)
from .dailymed import DailyMedSource, DailyMedSPLSource
from .ema import EMAMedicineSource, EMASource
from .example_source import ExampleDrugSource, ParsedRecord
from .fda import FDAOpenFDASource, FDASource, OpenFDADrugLabelSource
from .nmpa import NMPAOfficialPageSource, NMPASource

__all__ = [
    "AmbiguousResultError", "ContentTypeError", "DailyMedSource",
    "DailyMedSPLSource", "DrugNameMismatchError", "EMAMedicineSource",
    "EMASource", "ExampleDrugSource", "FDAOpenFDASource", "FDASource",
    "FieldConflictError", "HTTPResponse", "HTTPStatusError",
    "MissingDocumentIdError", "NMPAOfficialPageSource", "NMPASource",
    "NetworkError", "OfficialSourceRecord", "OpenFDADrugLabelSource",
    "ParseError", "ParsedRecord", "ResponseTooLargeError", "RobotsDeniedError", "SafeHTTPClient",
    "SchemaChangedError", "SecurityError", "SourceAdapterError",
]
