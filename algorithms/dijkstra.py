import heapq
import math
from itertools import count


def _validate_graph(graph):
    """Validate graph structure and non-negative integer/float weights."""
    if not isinstance(graph, dict):
        raise ValueError("Graph must be a dictionary of routers and neighbors")

    for router, neighbors in graph.items():
        if not isinstance(neighbors, dict):
            raise ValueError(
                f"Neighbors for router {router!r} must be a dictionary"
            )

        for neighbor, weight in neighbors.items():
            if neighbor not in graph:
                raise ValueError(
                    f"Neighbor {neighbor!r} referenced by router {router!r} "
                    "does not exist in the graph"
                )

            if isinstance(weight, bool) or not isinstance(weight, (int, float)):
                raise ValueError(
                    f"Edge weight from {router!r} to {neighbor!r} must be "
                    "a real number (int or float); booleans are not allowed"
                )

            if isinstance(weight, float) and not math.isfinite(weight):
                raise ValueError(
                    f"Edge weight from {router!r} to {neighbor!r} must be finite"
                )

            if weight < 0:
                raise ValueError(
                    f"Edge weight from {router!r} to {neighbor!r} "
                    "must be non-negative"
                )


def _run_dijkstra(graph, source, record_steps=False):
    """Run Dijkstra once, optionally collecting immutable-in-time snapshots."""
    _validate_graph(graph)

    if source not in graph:
        raise ValueError("Source router does not exist in the graph")

    distances = {router: float("inf") for router in graph}
    distances[source] = 0
    previous = {router: None for router in graph}
    visited = set()
    visited_order = []
    steps = []

    if record_steps:
        steps.append(
            {
                "step": 0,
                "current_router": None,
                "distances": distances.copy(),
                "previous": previous.copy(),
                "visited_order": visited_order.copy(),
                "distance_updates": [],
            }
        )

    queue_order = count()
    priority_queue = []
    heapq.heappush(priority_queue, (0, next(queue_order), source))

    while priority_queue:
        current_distance, _order, current_router = heapq.heappop(priority_queue)

        # Ignore outdated entries left behind after a shorter route was found.
        if current_distance != distances[current_router]:
            continue
        if current_router in visited:
            continue

        visited.add(current_router)
        visited_order.append(current_router)
        distance_updates = []

        for neighbor, weight in graph[current_router].items():
            if neighbor in visited:
                continue

            new_distance = current_distance + weight
            if new_distance < distances[neighbor]:
                old_distance = distances[neighbor]
                distances[neighbor] = new_distance
                previous[neighbor] = current_router
                heapq.heappush(
                    priority_queue,
                    (new_distance, next(queue_order), neighbor),
                )

                if record_steps:
                    distance_updates.append(
                        {
                            "router": neighbor,
                            "old_distance": old_distance,
                            "new_distance": new_distance,
                            "previous": current_router,
                        }
                    )

        if record_steps:
            steps.append(
                {
                    "step": len(steps),
                    "current_router": current_router,
                    "distances": distances.copy(),
                    "previous": previous.copy(),
                    "visited_order": visited_order.copy(),
                    "distance_updates": distance_updates.copy(),
                }
            )

    if record_steps:
        return distances, previous, visited_order, steps
    return distances, previous, visited_order


def dijkstra(graph, source):
    """Find shortest distances from source using a heap-based Dijkstra search.

    Args:
        graph: Dictionary mapping each router to a dictionary of neighboring
            routers and their non-negative int or float edge weights.
        source: Starting router; it must be a key in ``graph``.

    Returns:
        A tuple of ``distances``, ``previous``, and ``visited_order``.

    Raises:
        ValueError: If the graph is invalid or the source router is absent.
    """
    return _run_dijkstra(graph, source)


def dijkstra_with_steps(graph, source):
    """Run Dijkstra and return snapshots for step-by-step visualization.

    Each history entry contains ``step``, ``current_router``, copies of
    ``distances`` and ``previous``, a copy of ``visited_order``, and the
    ``distance_updates`` made while processing that router. Step zero is the
    initial state, before any router is finalized.

    Returns:
        A tuple of ``distances``, ``previous``, ``visited_order``, and ``steps``.

    Raises:
        ValueError: If the graph is invalid or the source router is absent.
    """
    return _run_dijkstra(graph, source, record_steps=True)


def shortest_path(previous, source, destination):
    """Reconstruct a path from source to destination using predecessor links.

    Args:
        previous: Mapping each router to its predecessor on the shortest path.
        source: Starting router.
        destination: Router to reach.

    Returns:
        The path from source to destination, or an empty list if the
        predecessor chain does not lead to the source.

    Raises:
        ValueError: If source or destination is not present in ``previous``.
    """
    if source not in previous:
        raise ValueError(f"Source router {source!r} does not exist")
    if destination not in previous:
        raise ValueError(f"Destination router {destination!r} does not exist")

    if source == destination:
        return [source]

    path = []
    current_router = destination
    seen = set()

    while current_router is not None:
        if current_router in seen:
            return []
        seen.add(current_router)
        path.append(current_router)

        if current_router == source:
            path.reverse()
            return path

        current_router = previous.get(current_router)

    return []


def build_routing_table(graph, source):
    """Build a per-destination routing table from a source router."""
    distances, previous, _visited_order = dijkstra(graph, source)
    routing_table = {}

    for destination, cost in distances.items():
        path = shortest_path(previous, source, destination)

        if not path:
            routing_table[destination] = {
                "next_hop": None,
                "cost": float("inf"),
                "path": [],
            }
        elif destination == source:
            routing_table[destination] = {
                "next_hop": None,
                "cost": 0,
                "path": [source],
            }
        else:
            routing_table[destination] = {
                "next_hop": path[1],
                "cost": cost,
                "path": path,
            }

    return routing_table
