"""
Tests for mem0_doc_search.py

Covers: fetch_url, search_docs, fetch_page, get_index, list_section, main()
All network calls are mocked via unittest.mock.patch.
"""

import argparse
import io
import json
import sys
import unittest
import urllib.error
import urllib.request
from unittest.mock import MagicMock, call, patch

import pytest

import mem0_doc_search as m


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_response(body: str, status: int = 200):
    """Return a mock HTTP response whose read() returns body as bytes."""
    resp = MagicMock()
    resp.read.return_value = body.encode("utf-8")
    resp.status = status
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    return resp


# ---------------------------------------------------------------------------
# fetch_url
# ---------------------------------------------------------------------------

class TestFetchUrl:
    def test_successful_get(self):
        mock_resp = _make_response("hello world")
        with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
            result = m.fetch_url("https://example.com/page")
        assert result == "hello world"
        mock_open.assert_called_once()
        req_arg = mock_open.call_args[0][0]
        assert req_arg.get_header("User-agent") == "Mem0DocSearchAgent/1.0"

    def test_http_error_returns_message(self):
        err = urllib.error.HTTPError(
            url="https://example.com", code=404, msg="Not Found",
            hdrs=None, fp=None  # type: ignore[arg-type]
        )
        with patch("urllib.request.urlopen", side_effect=err):
            result = m.fetch_url("https://example.com/missing")
        assert "404" in result
        assert "Not Found" in result

    def test_url_error_returns_message(self):
        err = urllib.error.URLError(reason="nodename nor servname provided")
        with patch("urllib.request.urlopen", side_effect=err):
            result = m.fetch_url("https://bad-host.invalid/")
        assert "URL Error" in result
        assert "nodename" in result

    def test_timeout_is_set(self):
        mock_resp = _make_response("ok")
        with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
            m.fetch_url("https://example.com/")
        _, kwargs = mock_open.call_args
        assert kwargs.get("timeout") == 15

    def test_unicode_body_decoded_correctly(self):
        body = "résumé café"
        mock_resp = _make_response(body)
        with patch("urllib.request.urlopen", return_value=mock_resp):
            result = m.fetch_url("https://example.com/unicode")
        assert result == body


# ---------------------------------------------------------------------------
# search_docs
# ---------------------------------------------------------------------------

FAKE_SEARCH_RESULTS = json.dumps({
    "results": [
        {"title": "Graph Memory", "url": "/platform/features/graph-memory", "description": "Graph mem docs"},
        {"title": "Webhooks", "url": "/platform/features/webhooks", "description": "Webhook docs"},
    ]
})

FAKE_LLMS_TXT = "\n".join([
    "# Mem0 docs index",
    "",
    "https://docs.mem0.ai/platform/overview",
    "https://docs.mem0.ai/platform/features/graph-memory",
    "https://docs.mem0.ai/api-reference/memory/add-memories",
    "https://docs.mem0.ai/sdks/python",
])


class TestSearchDocs:
    def test_uses_mintlify_api_when_available(self):
        with patch.object(m, "fetch_url", return_value=FAKE_SEARCH_RESULTS):
            result = m.search_docs("graph memory")
        assert result["source"] == "mintlify_search"
        assert len(result["results"]) == 2
        assert result["results"][0]["title"] == "Graph Memory"

    def test_falls_back_to_llms_txt_on_json_error(self):
        """If the search endpoint returns non-JSON, fall back to llms.txt."""
        responses = iter(["<html>error</html>", FAKE_LLMS_TXT])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("graph-memory")
        assert result["source"] == "llms_txt_index"
        assert any("graph-memory" in u for u in result["matching_urls"])

    def test_falls_back_when_results_key_missing(self):
        """API returns JSON but no 'results' key."""
        no_results = json.dumps({"data": []})
        responses = iter([no_results, FAKE_LLMS_TXT])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("something")
        assert result["source"] == "llms_txt_index"

    def test_section_filter_narrows_mintlify_results(self):
        with patch.object(m, "fetch_url", return_value=FAKE_SEARCH_RESULTS):
            result = m.search_docs("memory", section="api")
        # Both results have /platform/… paths, not /api-reference/… — should be filtered out
        assert result["source"] == "mintlify_search"
        assert result["results"] == []

    def test_section_filter_keeps_matching_mintlify_results(self):
        with patch.object(m, "fetch_url", return_value=FAKE_SEARCH_RESULTS):
            result = m.search_docs("memory", section="platform")
        assert len(result["results"]) == 2  # both are /platform/…

    def test_section_filter_on_llms_txt_fallback(self):
        responses = iter(["bad-json", FAKE_LLMS_TXT])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("memory", section="sdks")
        assert result["source"] == "llms_txt_index"
        assert all("/sdks/" in u for u in result["matching_urls"])

    def test_llms_txt_skips_blank_and_comment_lines(self):
        llms_content = "\n".join([
            "# comment",
            "",
            "https://docs.mem0.ai/platform/overview overview",
            "  ",
        ])
        responses = iter(["bad-json", llms_content])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("overview")
        # Only the non-blank, non-comment line containing "overview" should match
        assert len(result["matching_urls"]) == 1

    def test_llms_txt_results_capped_at_20(self):
        many_lines = "\n".join(
            [f"https://docs.mem0.ai/page/{i} keyword" for i in range(30)]
        )
        responses = iter(["bad-json", many_lines])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("keyword")
        assert len(result["matching_urls"]) <= 20

    def test_no_section_returns_all_llms_txt_matches(self):
        responses = iter(["bad-json", FAKE_LLMS_TXT])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("memory")
        assert result["source"] == "llms_txt_index"
        assert result.get("suggestion") is not None

    def test_case_insensitive_llms_txt_query(self):
        content = "https://docs.mem0.ai/platform/features/GRAPH-Memory"
        responses = iter(["bad-json", content])
        with patch.object(m, "fetch_url", side_effect=lambda u: next(responses)):
            result = m.search_docs("graph-memory")
        assert len(result["matching_urls"]) == 1


# ---------------------------------------------------------------------------
# fetch_page
# ---------------------------------------------------------------------------

class TestFetchPage:
    def test_prepends_base_for_slash_paths(self):
        with patch.object(m, "fetch_url", return_value="page content") as mock_fetch:
            result = m.fetch_page("/platform/overview")
        mock_fetch.assert_called_once_with("https://docs.mem0.ai/platform/overview")
        assert result["url"] == "https://docs.mem0.ai/platform/overview"

    def test_uses_path_as_is_when_no_leading_slash(self):
        full_url = "https://other.com/page"
        with patch.object(m, "fetch_url", return_value="content") as mock_fetch:
            result = m.fetch_page(full_url)
        mock_fetch.assert_called_once_with(full_url)
        assert result["url"] == full_url

    def test_content_not_truncated_under_10000_chars(self):
        body = "x" * 5000
        with patch.object(m, "fetch_url", return_value=body):
            result = m.fetch_page("/short")
        assert result["content"] == body
        assert result["truncated"] is False

    def test_content_truncated_over_10000_chars(self):
        body = "y" * 15000
        with patch.object(m, "fetch_url", return_value=body):
            result = m.fetch_page("/long")
        assert len(result["content"]) == 10000
        assert result["truncated"] is True

    def test_content_exactly_10000_chars_not_truncated(self):
        body = "z" * 10000
        with patch.object(m, "fetch_url", return_value=body):
            result = m.fetch_page("/exact")
        assert result["truncated"] is False

    def test_returns_url_in_result(self):
        with patch.object(m, "fetch_url", return_value="data"):
            result = m.fetch_page("/some/path")
        assert "url" in result
        assert "content" in result
        assert "truncated" in result


# ---------------------------------------------------------------------------
# get_index
# ---------------------------------------------------------------------------

class TestGetIndex:
    def test_returns_total_pages_and_urls(self):
        llms_content = "\n".join([
            "# header",
            "",
            "https://docs.mem0.ai/page1",
            "https://docs.mem0.ai/page2",
            "https://docs.mem0.ai/page3",
        ])
        with patch.object(m, "fetch_url", return_value=llms_content):
            result = m.get_index()
        assert result["total_pages"] == 3
        assert len(result["urls"]) == 3
        assert "https://docs.mem0.ai/page1" in result["urls"]

    def test_sections_list_matches_section_map(self):
        with patch.object(m, "fetch_url", return_value=""):
            result = m.get_index()
        assert set(result["sections"]) == set(m.SECTION_MAP.keys())

    def test_skips_blank_and_comment_lines(self):
        content = "# comment\n\nhttps://docs.mem0.ai/real-page\n   \n"
        with patch.object(m, "fetch_url", return_value=content):
            result = m.get_index()
        assert result["total_pages"] == 1
        assert result["urls"] == ["https://docs.mem0.ai/real-page"]

    def test_fetches_llms_index_url(self):
        with patch.object(m, "fetch_url", return_value="") as mock_fetch:
            m.get_index()
        mock_fetch.assert_called_once_with(m.LLMS_INDEX)


# ---------------------------------------------------------------------------
# list_section
# ---------------------------------------------------------------------------

class TestListSection:
    def test_known_section_returns_full_urls(self):
        result = m.list_section("platform")
        assert result["section"] == "platform"
        for page in result["pages"]:
            assert page.startswith(m.DOCS_BASE)
        # Verify a known path is included
        assert any("platform" in p for p in result["pages"])

    def test_unknown_section_returns_error(self):
        result = m.list_section("nonexistent-section")
        assert "error" in result
        assert "nonexistent-section" in result["error"]
        assert "available" in result

    def test_available_sections_listed_on_error(self):
        result = m.list_section("bad")
        assert set(result["available"]) == set(m.SECTION_MAP.keys())

    def test_all_known_sections_succeed(self):
        for section in m.SECTION_MAP:
            result = m.list_section(section)
            assert "section" in result
            assert "pages" in result
            assert result["section"] == section

    def test_pages_contain_section_paths(self):
        result = m.list_section("api")
        assert len(result["pages"]) == len(m.SECTION_MAP["api"])


# ---------------------------------------------------------------------------
# main() — CLI entry point
# ---------------------------------------------------------------------------

class TestMain:
    """Tests for the argparse-driven main() function."""

    def _run_main(self, argv, mock_func_name=None, mock_return=None):
        """Helper: patch sys.argv, call main(), capture stdout."""
        with patch("sys.argv", ["mem0_doc_search.py"] + argv):
            if mock_func_name:
                with patch.object(m, mock_func_name, return_value=mock_return) as mf:
                    captured = io.StringIO()
                    with patch("sys.stdout", captured):
                        m.main()
                    return captured.getvalue(), mf
            else:
                captured = io.StringIO()
                with patch("sys.stdout", captured):
                    m.main()
                return captured.getvalue(), None

    def test_no_args_exits_with_code_1(self):
        with patch("sys.argv", ["mem0_doc_search.py"]):
            with pytest.raises(SystemExit) as exc_info:
                m.main()
        assert exc_info.value.code == 1

    def test_index_flag_calls_get_index(self):
        fake_result = {"total_pages": 5, "urls": ["https://docs.mem0.ai/p1"], "sections": ["platform"]}
        out, mock_fn = self._run_main(["--index"], "get_index", fake_result)
        mock_fn.assert_called_once()
        assert "5" in out

    def test_query_calls_search_docs(self):
        fake_result = {"source": "mintlify_search", "results": [
            {"title": "Graph Memory", "url": "/platform/features/graph-memory", "description": "desc"}
        ]}
        out, mock_fn = self._run_main(["--query", "graph memory"], "search_docs", fake_result)
        mock_fn.assert_called_once_with("graph memory", section=None)
        assert "Graph Memory" in out

    def test_query_with_section_passes_section(self):
        fake_result = {"source": "llms_txt_index", "query": "memory", "matching_urls": [], "suggestion": "Fetch URLs"}
        out, mock_fn = self._run_main(["--query", "memory", "--section", "platform"], "search_docs", fake_result)
        mock_fn.assert_called_once_with("memory", section="platform")

    def test_page_calls_fetch_page(self):
        fake_result = {"url": "https://docs.mem0.ai/platform/overview", "content": "overview content", "truncated": False}
        out, mock_fn = self._run_main(["--page", "/platform/overview"], "fetch_page", fake_result)
        mock_fn.assert_called_once_with("/platform/overview")
        assert "overview content" in out

    def test_section_only_calls_list_section(self):
        fake_result = {"section": "platform", "pages": ["https://docs.mem0.ai/platform/overview"]}
        out, mock_fn = self._run_main(["--section", "platform"], "list_section", fake_result)
        mock_fn.assert_called_once_with("platform")
        assert "platform" in out

    def test_json_flag_outputs_valid_json(self):
        fake_result = {"total_pages": 2, "urls": ["a", "b"], "sections": ["platform"]}
        with patch("sys.argv", ["mem0_doc_search.py", "--index", "--json"]):
            with patch.object(m, "get_index", return_value=fake_result):
                captured = io.StringIO()
                with patch("sys.stdout", captured):
                    m.main()
        parsed = json.loads(captured.getvalue())
        assert parsed == fake_result

    def test_llms_txt_result_printed_without_json(self):
        fake_result = {
            "source": "llms_txt_index",
            "query": "webhooks",
            "matching_urls": ["https://docs.mem0.ai/platform/features/webhooks"],
            "suggestion": "Fetch specific URLs for detailed content",
        }
        out, _ = self._run_main(["--query", "webhooks"], "search_docs", fake_result)
        assert "webhooks" in out
        assert "Fetch specific URLs" in out

    def test_error_result_printed(self):
        fake_result = {"error": "Unknown section: bad", "available": ["platform", "api"]}
        with patch("sys.argv", ["mem0_doc_search.py", "--section", "bad"]):
            with patch.object(m, "list_section", return_value=fake_result):
                captured = io.StringIO()
                with patch("sys.stdout", captured):
                    m.main()
        out = captured.getvalue()
        assert "Unknown section" in out
        assert "platform" in out

    def test_page_truncated_notice_printed(self):
        fake_result = {
            "url": "https://docs.mem0.ai/platform/overview",
            "content": "x" * 10000,
            "truncated": True,
        }
        out, _ = self._run_main(["--page", "/platform/overview"], "fetch_page", fake_result)
        assert "truncated" in out.lower()

    def test_unknown_dict_result_printed_as_json(self):
        """Any result dict without known keys falls through to json.dumps."""
        fake_result = {"custom_key": "custom_value"}
        with patch("sys.argv", ["mem0_doc_search.py", "--index"]):
            with patch.object(m, "get_index", return_value=fake_result):
                captured = io.StringIO()
                with patch("sys.stdout", captured):
                    m.main()
        assert "custom_value" in captured.getvalue()


# ---------------------------------------------------------------------------
# Constants / module-level sanity
# ---------------------------------------------------------------------------

class TestModuleConstants:
    def test_docs_base_is_correct(self):
        assert m.DOCS_BASE == "https://docs.mem0.ai"

    def test_search_endpoint_uses_docs_base(self):
        assert m.SEARCH_ENDPOINT.startswith(m.DOCS_BASE)
        assert "search" in m.SEARCH_ENDPOINT

    def test_llms_index_uses_docs_base(self):
        assert m.LLMS_INDEX.startswith(m.DOCS_BASE)
        assert "llms.txt" in m.LLMS_INDEX

    def test_section_map_has_expected_keys(self):
        expected = {"platform", "api", "open-source", "sdks", "integrations"}
        assert expected == set(m.SECTION_MAP.keys())

    def test_section_map_values_are_lists_of_strings(self):
        for section, paths in m.SECTION_MAP.items():
            assert isinstance(paths, list), f"Section {section} should be a list"
            for path in paths:
                assert isinstance(path, str)
                assert path.startswith("/"), f"Path {path!r} should start with /"