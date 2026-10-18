"""Report-driven read-only GitHub enrichment, requiring only Python 3.10+."""
from .read import RecordedReaders, SourceReader, enrich_report
from .github import GitHubReader

__all__ = ['RecordedReaders', 'SourceReader', 'GitHubReader', 'enrich_report']
