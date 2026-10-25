import pytest


@pytest.fixture(autouse=True)
def _no_local_tuned_env(monkeypatch):
    """A tuned.env left by `python -m tools.autotune` on this machine must not change what the tests see."""
    monkeypatch.setenv("YT_TUNED_ENV", "0")
