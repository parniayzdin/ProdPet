import os
import tempfile
import unittest
from datetime import datetime, timezone
from uuid import uuid4

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"

from fastapi.testclient import TestClient
from auth import get_current_user_id
from main import app


class SessionIntegrationTest(unittest.TestCase):
    def test_short_race_saves_once_and_is_private(self):
        user = uuid4()
        app.dependency_overrides[get_current_user_id] = lambda: user
        try:
            with TestClient(app) as client:
                session = {"id": str(uuid4()), "task": "Study race", "date": datetime.now(timezone.utc).isoformat(), "seconds": 300, "duration": 300, "mode": "focus"}
                response = client.post("/sessions", json=session)
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()["total"], 50)
                self.assertEqual(response.json()["bonus"], 0)
                self.assertEqual(client.post("/sessions", json=session).status_code, 200)
                self.assertEqual(client.get(f"/users/{user}/stats").json()["completed_sessions"], 1)
                self.assertEqual(client.get(f"/users/{uuid4()}/sessions").status_code, 403)
                preflight = client.options("/sessions", headers={"Origin":"http://127.0.0.1:5174", "Access-Control-Request-Method":"POST"})
                self.assertEqual(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174")
        finally:
            app.dependency_overrides.clear()

    def test_missing_auth_is_rejected(self):
        with TestClient(app) as client:
            self.assertEqual(client.get(f"/users/{uuid4()}/stats").status_code, 401)


if __name__ == "__main__":
    unittest.main()
