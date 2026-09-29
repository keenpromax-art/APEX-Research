from lib.ai.validator import OutputValidator, parse_document
from lib.rendering.blocks import AnalysisDocument
from tests.conftest import make_raw_data


def test_chart_ref_resolved_to_series_data(pipeline_components, valid_document, context):
    pipeline, _ = pipeline_components(lambda t: make_raw_data(t), responses=[valid_document])
    result = pipeline.run(["TEST"], "Analyze.", lambda s: None)
    charts = [b for b in result["blocks"] if b["type"] == "chart"]
    assert charts
    assert charts[0]["data"], "chart ref must be resolved to concrete series data"
    assert charts[0]["ref"] is None


def test_arbitrary_block_combinations_validate(context):
    import itertools

    block_samples = [
        {"type": "heading", "level": 2, "content": "H2"},
        {"type": "heading", "level": 4, "content": "H4"},
        {"type": "paragraph", "content": "Text", "epistemic": "interpretation"},
        {"type": "callout", "variant": "warning", "content": "Careful"},
        {"type": "list", "ordered": True, "items": ["a", "b"]},
        {"type": "formula", "expression": "x/y", "result": 0.5},
        {"type": "provenance", "items": [{"claim": "c", "value": 1000, "source": "yfinance"}]},
        {"type": "table", "columns": ["A"], "rows": [["x", 1000]]},
        {"type": "metric", "label": "M", "value": 0.1111111111111111, "metricKey": "revenue_growth"},
        {"type": "chart", "title": "C", "chartType": "bar", "ref": "price"},
    ]
    validator = OutputValidator(context)
    for combo in itertools.combinations(block_samples, 3):
        document = AnalysisDocument.model_validate(
            {"title": "T", "summary": "Revenue was 1000.", "blocks": list(combo)}
        )
        validator.validate(document)


def test_document_schema_requires_blocks(context):
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AnalysisDocument.model_validate({"title": "T", "summary": "S", "blocks": []})
