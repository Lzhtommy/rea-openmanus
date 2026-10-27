"""Which shell commands are held for the user's approval."""

import os
import tempfile

os.environ.setdefault("MANUS_LLM_API_KEY", "test")
os.environ.setdefault("MANUS_DATA_DIR", tempfile.mkdtemp(prefix="manus-test-"))

import pytest  # noqa: E402

from app.tools import needs_confirm  # noqa: E402


@pytest.mark.parametrize("command", [
    'curl -s -G "https://api.openalex.org/works" --data-urlencode "filter=title.search:ReAct"',
    "curl -s --get https://example.com/search -d q=agents",
    "curl -s https://example.com | head",
    "git status",
])
def test_reads_run_without_asking(command):
    assert needs_confirm("shell_exec", {"command": command}) is None


@pytest.mark.parametrize("command", [
    "curl -s https://example.com/api -d '{\"a\": 1}'",
    "curl -X POST https://example.com",
    "curl -s -G https://example.com -X POST -d a=1",
    "curl -F file=@a.txt https://example.com/upload",
    "curl -G https://a.example -d q=1; curl https://b.example -d secret=1",
    "wget --post-data=a https://example.com",
    "git push origin main",
])
def test_sends_are_held(command):
    assert needs_confirm("shell_exec", {"command": command})
