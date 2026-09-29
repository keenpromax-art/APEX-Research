import pytest

from lib.ai.validator import OutputValidator, ValidationFailure, parse_document
from lib.rendering.blocks import AnalysisDocument


def _doc(blocks, title="T", summary="S"):
    return AnalysisDocument.model_validate({"title": title, "summary": summary, "blocks": blocks})


def test_valid_document_passes(context, valid_document):
    document = parse_document(valid_document)
    OutputValidator(context).validate(document)


def test_hallucinated_number_in_paragraph_rejected(context):
    document = _doc([{"type": "paragraph", "content": "Revenue grew to 999999 last year."}])
    with pytest.raises(ValidationFailure) as exc:
        OutputValidator(context).validate(document)
    assert any("999999" in p for p in exc.value.problems)


def test_hallucinated_number_in_table_rejected(context):
    document = _doc([{"type": "table", "columns": ["A"], "rows": [[12345678]]}])
    with pytest.raises(ValidationFailure):
        OutputValidator(context).validate(document)


def test_unknown_metric_key_rejected(context):
    document = _doc([{"type": "metric", "label": "X", "value": 1.0, "metricKey": "not_a_metric"}])
    with pytest.raises(ValidationFailure) as exc:
        OutputValidator(context).validate(document)
    assert any("not_a_metric" in p for p in exc.value.problems)


def test_metric_value_mismatch_rejected(context):
    document = _doc([{"type": "metric", "label": "X", "value": 0.5, "metricKey": "revenue_growth"}])
    with pytest.raises(ValidationFailure):
        OutputValidator(context).validate(document)


def test_unknown_chart_ref_rejected(context):
    document = _doc([{"type": "chart", "title": "X", "ref": "not_a_series"}])
    with pytest.raises(ValidationFailure):
        OutputValidator(context).validate(document)


def test_malformed_json_rejected():
    with pytest.raises(ValidationFailure):
        parse_document("not json at all")


def test_schema_violation_rejected():
    with pytest.raises(ValidationFailure):
        parse_document('{"title":"T","summary":"S","blocks":[{"type":"unknown_block"}]}')


def test_allowed_unchecked_numbers(context):
    document = _doc(
        [
            {"type": "paragraph", "content": "In 2024 there were 3 segments and 12 months. Q3 was strong."},
        ]
    )
    OutputValidator(context).validate(document)


def test_traceable_forms_of_known_values(context):
    document = _doc(
        [
            {"type": "paragraph", "content": "Revenue was 1,000 or 1000.0 or 1.0B or 10.0% or 10.0x."},
        ]
    )
    OutputValidator(context).validate(document)


def test_percentage_of_known_ratio(context):
    document = _doc([{"type": "paragraph", "content": "Gross margin was 40%."}])
    OutputValidator(context).validate(document)


def test_arbitrary_block_combinations_validate(context):
    blocks = [
        {"type": "heading", "level": 3, "content": "Deep dive"},
        {"type": "callout", "variant": "warning", "content": "Only 2 periods available."},
        {"type": "list", "ordered": True, "items": ["Point one", "Point two"]},
        {"type": "formula", "expression": "a / b", "result": 0.5},
        {"type": "provenance", "items": [{"claim": "Revenue", "value": 1000, "source": "yfinance"}]},
    ]
    document = _doc(blocks)
    OutputValidator(context).validate(document)
