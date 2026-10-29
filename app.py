"""Flask API for the NetRoute shortest-path simulator."""

import math

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from algorithms.dijkstra import (
    _validate_graph,
    build_routing_table,
    dijkstra,
    dijkstra_with_steps,
    shortest_path,
)

app = Flask(__name__)

PRESETS = [
    {
        "id": "small-network",
        "name": "Small Office",
        "description": "A compact four-router network for a quick walkthrough.",
        "graph": {
            "A": {"B": 4, "C": 2},
            "B": {"A": 4, "C": 1, "D": 5},
            "C": {"A": 2, "B": 1, "D": 8},
            "D": {"B": 5, "C": 8},
        },
        "default_source": "A",
        "default_destination": "D",
    },
    {
        "id": "larger-network",
        "name": "Campus Backbone",
        "description": "A six-router topology with several alternative links.",
        "graph": {
            "A": {"B": 3, "C": 7},
            "B": {"A": 3, "C": 2, "D": 6},
            "C": {"A": 7, "B": 2, "D": 3, "E": 5},
            "D": {"B": 6, "C": 3, "E": 2, "F": 6},
            "E": {"C": 5, "D": 2, "F": 1},
            "F": {"D": 6, "E": 1},
        },
        "default_source": "A",
        "default_destination": "F",
    },
    {
        "id": "alternative-route",
        "name": "Alternative Route",
        "description": "Two routes connect the source to the destination.",
        "graph": {
            "A": {"B": 2, "C": 1},
            "B": {"A": 2, "C": 1, "D": 2},
            "C": {"A": 1, "B": 1, "D": 5},
            "D": {"B": 2, "C": 5},
        },
        "default_source": "A",
        "default_destination": "D",
    },
]


def _api_error(code, message, status):
    """Create the consistent JSON error envelope used by API routes."""
    return jsonify({"error": {"code": code, "message": message}}), status


def _read_json_object():
    """Read a JSON request body and reject malformed or non-object bodies."""
    if not request.is_json:
        return None, _api_error(
            "invalid_json", "Request body must use JSON content type.", 400
        )

    payload = request.get_json(silent=True)
    if payload is None:
        return None, _api_error(
            "invalid_json", "Request body must contain valid JSON.", 400
        )
    if not isinstance(payload, dict):
        return None, _api_error(
            "invalid_request", "Request body must be a JSON object.", 400
        )

    return payload, None


def _required_graph(payload):
    if "graph" not in payload:
        return None, _api_error(
            "missing_field", "Request is missing required field 'graph'.", 400
        )

    graph = payload["graph"]
    try:
        _validate_graph(graph)
    except ValueError as error:
        return None, _api_error("invalid_graph", str(error), 400)

    return graph, None


def _required_router(payload, field_name):
    if field_name not in payload:
        return None, _api_error(
            "missing_field",
            f"Request is missing required field '{field_name}'.",
            400,
        )

    router = payload[field_name]
    if not isinstance(router, str):
        return None, _api_error(
            "invalid_field",
            f"Field '{field_name}' must be a router name string.",
            400,
        )

    return router, None


def _check_router_exists(graph, router, field_name):
    if router not in graph:
        return _api_error(
            "invalid_router",
            f"Router in field '{field_name}' does not exist in the graph.",
            400,
        )
    return None


def _json_safe(value):
    """Replace non-finite floats recursively so responses use standard JSON."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "message": "NetRoute API is running."})


@app.get("/api/presets")
def presets():
    return jsonify({"presets": PRESETS})


@app.post("/api/network/validate")
def validate_network():
    payload, error_response = _read_json_object()
    if error_response:
        return error_response

    graph, error_response = _required_graph(payload)
    if error_response:
        return error_response

    return jsonify({"valid": True, "router_count": len(graph)})


@app.post("/api/shortest-path")
def shortest_path_endpoint():
    payload, error_response = _read_json_object()
    if error_response:
        return error_response

    graph, error_response = _required_graph(payload)
    if error_response:
        return error_response

    source, error_response = _required_router(payload, "source")
    if error_response:
        return error_response
    destination, error_response = _required_router(payload, "destination")
    if error_response:
        return error_response

    error_response = _check_router_exists(graph, source, "source")
    if error_response:
        return error_response
    error_response = _check_router_exists(graph, destination, "destination")
    if error_response:
        return error_response

    distances, previous, visited_order = dijkstra(graph, source)
    path = shortest_path(previous, source, destination)
    reachable = bool(path)

    return jsonify(
        {
            "source": source,
            "destination": destination,
            "reachable": reachable,
            "path": path,
            "cost": distances[destination] if reachable else None,
            "visited_order": visited_order,
        }
    )


@app.post("/api/simulate")
def simulate():
    payload, error_response = _read_json_object()
    if error_response:
        return error_response

    graph, error_response = _required_graph(payload)
    if error_response:
        return error_response

    source, error_response = _required_router(payload, "source")
    if error_response:
        return error_response
    error_response = _check_router_exists(graph, source, "source")
    if error_response:
        return error_response

    distances, previous, visited_order, steps = dijkstra_with_steps(graph, source)
    return jsonify(
        _json_safe(
            {
                "source": source,
                "distances": distances,
                "previous": previous,
                "visited_order": visited_order,
                "steps": steps,
            }
        )
    )


@app.post("/api/routing-table")
def routing_table():
    payload, error_response = _read_json_object()
    if error_response:
        return error_response

    graph, error_response = _required_graph(payload)
    if error_response:
        return error_response

    source, error_response = _required_router(payload, "source")
    if error_response:
        return error_response
    error_response = _check_router_exists(graph, source, "source")
    if error_response:
        return error_response

    return jsonify(
        _json_safe(
            {
                "source": source,
                "routing_table": build_routing_table(graph, source),
            }
        )
    )


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if request.path.startswith("/api/"):
        code = "not_found" if error.code == 404 else "http_error"
        return _api_error(code, error.description, error.code or 500)
    return error


@app.errorhandler(Exception)
def handle_unexpected_error(_error):
    # Keep implementation details and tracebacks out of client responses.
    app.logger.exception("Unhandled NetRoute API error")
    return _api_error(
        "internal_server_error", "An unexpected server error occurred.", 500
    )


if __name__ == "__main__":
    app.run(debug=False)


