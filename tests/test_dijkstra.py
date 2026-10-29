import math
import unittest

from algorithms.dijkstra import (
    build_routing_table,
    dijkstra,
    dijkstra_with_steps,
    shortest_path,
)


class TestDijkstra(unittest.TestCase):
    def test_connected_graph_from_a(self):
        graph = {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        }

        distances, previous, visited_order = dijkstra(graph, "A")

        self.assertEqual(distances, {"A": 0, "B": 3, "C": 2, "D": 8})
        self.assertEqual(previous, {"A": None, "B": "C", "C": "A", "D": "B"})
        self.assertEqual(visited_order, ["A", "C", "B", "D"])

    def test_disconnected_graph_keeps_isolated_router_unreachable(self):
        graph = {
            "A": {"B": 2},
            "B": {"A": 2},
            "Isolated": {},
        }

        distances, _previous, visited_order = dijkstra(graph, "A")

        self.assertTrue(math.isinf(distances["Isolated"]))
        self.assertNotIn("Isolated", visited_order)

    def test_single_router_graph(self):
        graph = {"A": {}}

        distances, previous, visited_order = dijkstra(graph, "A")

        self.assertEqual(distances["A"], 0)
        self.assertIsNone(previous["A"])
        self.assertEqual(visited_order, ["A"])

    def test_invalid_source_raises_value_error(self):
        graph = {"A": {}}

        with self.assertRaises(ValueError):
            dijkstra(graph, "Missing")

    def test_zero_weight_edges(self):
        graph = {"A": {"B": 0, "C": 1}, "B": {"C": 0}, "C": {}}

        distances, previous, _visited_order = dijkstra(graph, "A")

        self.assertEqual(distances, {"A": 0, "B": 0, "C": 0})
        self.assertEqual(previous["C"], "B")

    def test_multiple_equal_cost_shortest_paths(self):
        graph = {
            "A": {"B": 1, "C": 1},
            "B": {"D": 1},
            "C": {"D": 1},
            "D": {},
        }

        distances, previous, _visited_order = dijkstra(graph, "A")

        self.assertEqual(distances["D"], 2)
        self.assertEqual(previous["D"], "B")

    def test_mixed_integer_and_float_weights(self):
        graph = {"A": {"B": 1}, "B": {"C": 1.5}, "C": {}}

        distances, previous, _visited_order = dijkstra(graph, "A")

        self.assertEqual(distances["C"], 2.5)
        self.assertEqual(previous["C"], "B")

    def test_very_large_integer_weights(self):
        very_large = 10**1000
        graph = {"A": {"B": very_large}, "B": {"C": very_large}, "C": {}}

        distances, _previous, _visited_order = dijkstra(graph, "A")

        self.assertEqual(distances["B"], very_large)
        self.assertEqual(distances["C"], 2 * very_large)

    def test_integer_and_string_router_labels(self):
        graph = {1: {"router": 2}, "router": {2: 3}, 2: {}}

        distances, previous, visited_order = dijkstra(graph, 1)

        self.assertEqual(distances[2], 5)
        self.assertEqual(previous[2], "router")
        self.assertEqual(visited_order, [1, "router", 2])

    def test_stale_priority_queue_entries_are_ignored(self):
        graph = {
            "A": {"B": 10, "C": 1},
            "B": {"D": 1},
            "C": {"B": 1, "D": 20},
            "D": {},
        }

        distances, previous, visited_order = dijkstra(graph, "A")

        self.assertEqual(distances, {"A": 0, "B": 2, "C": 1, "D": 3})
        self.assertEqual(previous["B"], "C")
        self.assertEqual(visited_order, ["A", "C", "B", "D"])


class TestShortestPath(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        }

    def test_shortest_path_from_a_to_d(self):
        _distances, previous, _visited_order = dijkstra(self.graph, "A")

        self.assertEqual(shortest_path(previous, "A", "D"), ["A", "C", "B", "D"])

    def test_path_from_source_to_itself(self):
        _distances, previous, _visited_order = dijkstra(self.graph, "A")

        self.assertEqual(shortest_path(previous, "A", "A"), ["A"])

    def test_unreachable_destination_returns_empty_path(self):
        graph = {"A": {"B": 1}, "B": {"A": 1}, "C": {}}
        _distances, previous, _visited_order = dijkstra(graph, "A")

        self.assertEqual(shortest_path(previous, "A", "C"), [])

    def test_invalid_source_raises_value_error(self):
        _distances, previous, _visited_order = dijkstra(self.graph, "A")

        with self.assertRaises(ValueError):
            shortest_path(previous, "Missing", "D")

    def test_invalid_destination_raises_value_error(self):
        _distances, previous, _visited_order = dijkstra(self.graph, "A")

        with self.assertRaises(ValueError):
            shortest_path(previous, "A", "Missing")

    def test_cyclic_predecessors_return_empty_path(self):
        previous = {"A": None, "B": "C", "C": "B"}

        self.assertEqual(shortest_path(previous, "A", "B"), [])


class TestGraphValidation(unittest.TestCase):
    def test_negative_edge_weight(self):
        with self.assertRaisesRegex(ValueError, "negative"):
            dijkstra({"A": {"B": -1}, "B": {}}, "A")

    def test_boolean_edge_weight(self):
        with self.assertRaisesRegex(ValueError, "real number"):
            dijkstra({"A": {"B": True}, "B": {}}, "A")

    def test_non_numeric_edge_weight(self):
        with self.assertRaisesRegex(ValueError, "real number"):
            dijkstra({"A": {"B": "fast"}, "B": {}}, "A")

    def test_infinite_edge_weight(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            dijkstra({"A": {"B": float("inf")}, "B": {}}, "A")

    def test_nan_edge_weight(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            dijkstra({"A": {"B": float("nan")}, "B": {}}, "A")

    def test_neighbor_missing_from_graph(self):
        with self.assertRaisesRegex(ValueError, "does not exist"):
            dijkstra({"A": {"Missing": 1}}, "A")

    def test_non_dictionary_graph(self):
        with self.assertRaisesRegex(ValueError, "dictionary"):
            dijkstra([], "A")


class TestRoutingTable(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        }

    def test_example_routing_table_from_a(self):
        self.assertEqual(
            build_routing_table(self.graph, "A"),
            {
                "A": {"next_hop": None, "cost": 0, "path": ["A"]},
                "B": {"next_hop": "C", "cost": 3, "path": ["A", "C", "B"]},
                "C": {"next_hop": "C", "cost": 2, "path": ["A", "C"]},
                "D": {
                    "next_hop": "C",
                    "cost": 8,
                    "path": ["A", "C", "B", "D"],
                },
            },
        )

    def test_next_hop_for_d_from_a(self):
        table = build_routing_table(self.graph, "A")

        self.assertEqual(table["D"]["next_hop"], "C")

    def test_source_entry(self):
        table = build_routing_table(self.graph, "A")

        self.assertEqual(
            table["A"],
            {"next_hop": None, "cost": 0, "path": ["A"]},
        )

    def test_unreachable_destination_entry(self):
        graph = {"A": {"B": 1}, "B": {}, "Isolated": {}}

        table = build_routing_table(graph, "A")

        self.assertIsNone(table["Isolated"]["next_hop"])
        self.assertTrue(math.isinf(table["Isolated"]["cost"]))
        self.assertEqual(table["Isolated"]["path"], [])

    def test_directed_graph_is_supported(self):
        graph = {"A": {"B": 2}, "B": {"C": 3}, "C": {}}

        table = build_routing_table(graph, "A")

        self.assertEqual(
            table["C"],
            {"next_hop": "B", "cost": 5, "path": ["A", "B", "C"]},
        )
        self.assertTrue(math.isinf(build_routing_table(graph, "C")["A"]["cost"]))


class TestDijkstraHistory(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        }

    def test_initial_history_state(self):
        _distances, _previous, _visited_order, steps = dijkstra_with_steps(
            self.graph, "A"
        )

        self.assertEqual(
            steps[0],
            {
                "step": 0,
                "current_router": None,
                "distances": {
                    "A": 0,
                    "B": float("inf"),
                    "C": float("inf"),
                    "D": float("inf"),
                },
                "previous": {"A": None, "B": None, "C": None, "D": None},
                "visited_order": [],
                "distance_updates": [],
            },
        )

    def test_history_records_router_finalization_and_updates(self):
        _distances, _previous, _visited_order, steps = dijkstra_with_steps(
            self.graph, "A"
        )

        self.assertEqual(steps[1]["current_router"], "A")
        self.assertEqual(steps[1]["visited_order"], ["A"])
        self.assertEqual(
            steps[1]["distance_updates"],
            [
                {
                    "router": "B",
                    "old_distance": float("inf"),
                    "new_distance": 4,
                    "previous": "A",
                },
                {
                    "router": "C",
                    "old_distance": float("inf"),
                    "new_distance": 2,
                    "previous": "A",
                },
            ],
        )
        self.assertEqual(steps[2]["current_router"], "C")
        self.assertEqual(steps[2]["distance_updates"][0]["router"], "B")
        self.assertEqual(steps[2]["distance_updates"][0]["old_distance"], 4)
        self.assertEqual(steps[2]["distance_updates"][0]["new_distance"], 3)

    def test_history_snapshots_do_not_change_after_later_steps(self):
        _distances, final_previous, final_visited_order, steps = dijkstra_with_steps(
            self.graph, "A"
        )

        self.assertEqual(steps[1]["distances"]["B"], 4)
        self.assertEqual(steps[1]["visited_order"], ["A"])
        self.assertEqual(steps[2]["distances"]["B"], 3)
        self.assertEqual(steps[2]["visited_order"], ["A", "C"])
        self.assertIsNot(steps[1]["distances"], steps[2]["distances"])
        self.assertEqual(final_previous["B"], "C")
        self.assertEqual(final_visited_order, ["A", "C", "B", "D"])

    def test_dijkstra_matches_history_run_results(self):
        expected = dijkstra(self.graph, "A")
        actual = dijkstra_with_steps(self.graph, "A")[:3]

        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
