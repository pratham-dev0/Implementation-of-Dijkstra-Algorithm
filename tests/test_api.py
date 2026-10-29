import unittest

from app import app


class NetRouteApiTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()
        self.graph = {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        }

    def test_health_endpoint(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_presets_endpoint_and_structure(self):
        response = self.client.get("/api/presets")

        self.assertEqual(response.status_code, 200)
        presets = response.get_json()["presets"]
        self.assertGreaterEqual(len(presets), 3)
        for preset in presets:
            with self.subTest(preset=preset["id"]):
                self.assertTrue(preset["name"])
                self.assertTrue(preset["description"])
                self.assertIsInstance(preset["graph"], dict)
                self.assertIn(preset["default_source"], preset["graph"])
                self.assertIn(preset["default_destination"], preset["graph"])

    def test_valid_graph_validation(self):
        response = self.client.post(
            "/api/network/validate", json={"graph": self.graph}
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["valid"])
        self.assertEqual(response.get_json()["router_count"], 4)

    def test_invalid_graph_validation(self):
        response = self.client.post(
            "/api/network/validate",
            json={"graph": {"A": {"B": -1}, "B": {}}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["code"], "invalid_graph")
        self.assertIn("non-negative", response.get_json()["error"]["message"])

    def test_successful_shortest_path(self):
        response = self.client.post(
            "/api/shortest-path",
            json={
                "graph": self.graph,
                "source": "A",
                "destination": "D",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "source": "A",
                "destination": "D",
                "reachable": True,
                "path": ["A", "C", "B", "D"],
                "cost": 8,
                "visited_order": ["A", "C", "B", "D"],
            },
        )

    def test_unreachable_destination_uses_null_cost(self):
        graph = {"A": {"B": 1}, "B": {}, "Isolated": {}}
        response = self.client.post(
            "/api/shortest-path",
            json={"graph": graph, "source": "A", "destination": "Isolated"},
        )

        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertFalse(result["reachable"])
        self.assertEqual(result["path"], [])
        self.assertIsNone(result["cost"])

    def test_simulation_includes_history_and_standard_json(self):
        graph = {"A": {"B": 1}, "B": {}, "Isolated": {}}
        response = self.client.post(
            "/api/simulate", json={"graph": graph, "source": "A"}
        )

        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertEqual(result["distances"]["A"], 0)
        self.assertEqual(result["distances"]["B"], 1)
        self.assertIsNone(result["distances"]["Isolated"])
        self.assertGreaterEqual(len(result["steps"]), 2)
        self.assertEqual(result["steps"][0]["step"], 0)
        self.assertEqual(result["steps"][0]["current_router"], None)
        self.assertNotIn(b"Infinity", response.data)
        self.assertNotIn(b"NaN", response.data)

    def test_routing_table_response(self):
        graph = {"A": {"B": 2}, "B": {}, "Isolated": {}}
        response = self.client.post(
            "/api/routing-table", json={"graph": graph, "source": "A"}
        )

        self.assertEqual(response.status_code, 200)
        table = response.get_json()["routing_table"]
        self.assertEqual(
            table["B"],
            {"next_hop": "B", "cost": 2, "path": ["A", "B"]},
        )
        self.assertIsNone(table["Isolated"]["next_hop"])
        self.assertIsNone(table["Isolated"]["cost"])
        self.assertEqual(table["Isolated"]["path"], [])

    def test_missing_required_fields(self):
        response = self.client.post("/api/shortest-path", json={"graph": self.graph})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["code"], "missing_field")
        self.assertIn("source", response.get_json()["error"]["message"])

    def test_malformed_json_body(self):
        response = self.client.post(
            "/api/network/validate",
            data="{not valid json",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["code"], "invalid_json")

    def test_unknown_api_endpoint(self):
        response = self.client.get("/api/does-not-exist")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"]["code"], "not_found")


if __name__ == "__main__":
    unittest.main()
