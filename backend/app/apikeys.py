"""Developer API keys (Manus' 开发者 settings): programmatic access to tasks.

Keys are shown once and stored hashed; each belongs to the user who created it, and /api/v1 calls made
with it run as that user.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time

from . import config, storage


class ApiKeys:
    def __init__(self):
        self.path = config.DATA_DIR / "api_keys.json"
        self.items: dict[str, dict] = {}
        if self.path.exists():
            try:
                self.items = {k["id"]: k for k in json.loads(self.path.read_text())}
            except (ValueError, KeyError):
                self.items = {}

    def save(self) -> None:
        storage.write_json(self.path, list(self.items.values()), private=True)

    @staticmethod
    def public(k: dict) -> dict:
        return {x: k.get(x) for x in ("id", "name", "prefix", "createdAt", "lastUsed")}

    def create(self, name: str, owner: str | None) -> tuple[dict, str]:
        key = "om_" + secrets.token_urlsafe(30)
        k = {"id": secrets.token_hex(4), "name": (name or "API key").strip()[:40], "prefix": key[:9],
             "hash": hashlib.sha256(key.encode()).hexdigest(), "owner": owner, "createdAt": time.time(), "lastUsed": None}
        self.items[k["id"]] = k
        self.save()
        return self.public(k), key

    def check(self, key: str) -> dict | None:
        h = hashlib.sha256((key or "").encode()).hexdigest()
        k = next((x for x in self.items.values() if secrets.compare_digest(x["hash"], h)), None)
        if k:
            k["lastUsed"] = time.time()
            self.save()
        return k

    def delete(self, kid: str) -> None:
        self.items.pop(kid, None)
        self.save()


store: ApiKeys | None = None
