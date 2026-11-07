#!/usr/bin/env python3
"""Validate the bounded completion documentation; never traverse author libraries."""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    return json.loads((ROOT / "docs" / name).read_text())


def assert_terminal_coverage(nodes, terminal):
    """Every retained node must be required by the final milestone, not only optional edges."""
    required = set()

    def collect(node_id):
        if node_id in required:
            return
        required.add(node_id)
        for parent in nodes[node_id]["dependsOn"]:
            collect(parent)

    assert terminal in nodes, f"Missing terminal {terminal}"
    collect(terminal)
    assert required == set(nodes), f"Not covered by {terminal}: {sorted(set(nodes) - required)}"


def validate_execution(lanes):
    execution = load("concurrent-delivery.json")
    streams = {stream["id"]: stream for stream in execution["streams"]}
    work = {item["id"]: item for item in execution["work"]}
    assert len(streams) == len(execution["streams"]), "Duplicate stream ID"
    assert len(work) == len(execution["work"]), "Duplicate work-package ID"
    work_lanes = execution["workLanes"]
    assert set(work_lanes) == set(work), "Work-package lane coverage mismatch"
    assigned = {stream_id: set() for stream_id in streams}
    for item_id, item in work.items():
        assert item["stream"] in streams, f"Unknown stream: {item_id}"
        scope = work_lanes[item_id]
        assert scope and len(scope) == len(set(scope)), f"Invalid work lane scope: {item_id}"
        assert set(scope) <= set(streams[item["stream"]]["lanes"]), f"Work outside stream scope: {item_id}"
        assigned[item["stream"]].update(scope)
    covered = set()
    for stream in streams.values():
        assert stream["lanes"], f"Empty stream: {stream['id']}"
        assert len(stream["lanes"]) == len(set(stream["lanes"])), "Duplicate lane in stream"
        assert set(stream["lanes"]) <= set(lanes), f"Unknown lane in {stream['id']}"
        assert assigned[stream["id"]] == set(stream["lanes"]), f"Stream lanes without assigned work: {stream['id']}"
        covered.update(stream["lanes"])
    assert covered == set(lanes), f"Unowned execution lanes: {set(lanes) - covered}"
    assert 1 <= execution["maxConcurrentIntegrationGates"] <= execution["maxConcurrentAgents"]
    wave = execution["firstWave"]
    assert len(wave) == len(set(wave)) <= execution["maxConcurrentAgents"], "Invalid first wave"
    assert set(wave) <= set(work), "Unknown first-wave work package"
    assert len({work[item]["stream"] for item in wave}) == len(wave), "Competing first-wave stream owners"
    active, done, edges = set(), set(), set()

    def visit(item_id):
        assert item_id not in active, f"Execution cycle at {item_id}"
        if item_id in done:
            return
        active.add(item_id)
        item = work[item_id]
        assert item["stream"] in streams, f"Unknown stream: {item_id}"
        assert item["gate"].strip(), f"Missing gate: {item_id}"
        assert len(item["dependsOn"]) == len(set(item["dependsOn"])), f"Duplicate dependency: {item_id}"
        for parent in item["dependsOn"]:
            assert parent in work, f"Unknown work prerequisite: {parent}"
            edges.add((parent, item_id))
            visit(parent)
        active.remove(item_id)
        done.add(item_id)

    for item_id in work:
        visit(item_id)
    for item_id in wave:
        assert not set(work[item_id]["dependsOn"]) & set(wave), "First-wave dependency race"
    assert_terminal_coverage(work, "W99")
    markdown = (ROOT / "docs" / "CONCURRENT-DELIVERY.md").read_text()
    diagram = re.search(r"```mermaid\n(.*?)```", markdown, re.S)
    assert diagram, "Missing execution diagram"
    shown = set(re.findall(r"\b(W\d{2})(?:\[[^\]\n]*\])?\s*-->\s*(W\d{2})", diagram[1]))
    assert edges == shown, f"Execution Mermaid mismatch: {edges ^ shown}"
    print(f"Execution valid: {len(streams)} streams, {len(work)} packages, {len(edges)} edges, "
          f"{len(wave)} initial agents; assigned lane scopes and terminal coverage valid")


def validate():
    graph = load("product-completion.json")
    requirements = load("completion-requirements.json")["requirements"]
    ownership = load("completion-specs.json")
    lanes = {lane["id"]: lane for lane in graph["lanes"]}
    assert len(lanes) == len(graph["lanes"]), "Duplicate lane IDs"
    req_ids = {req["id"] for req in requirements}
    assert len(req_ids) == len(requirements), "Duplicate requirement IDs"
    assert set(ownership["requirements"]) == req_ids, "Requirement ownership mismatch"
    assert set(ownership["lanes"]) == set(lanes), "Lane ownership mismatch"
    specs = {}
    for path in (ROOT / "specs").glob("[0-9][0-9][0-9]-*/spec.md"):
        number = path.parent.name[:3]
        assert number not in specs, f"Duplicate spec number {number}"
        specs[number] = path
    reserved = ownership["reservedSpecs"]
    assert not set(reserved) & set(specs), "Reserved spec now exists: reconcile its ownership"
    index = (ROOT / "specs" / "README.md").read_text()
    for number in reserved:
        assert re.search(rf"\| {number} \|.*Reserved", index), f"Missing reservation {number}"
    for lane_id, numbers in ownership["lanes"].items():
        assert numbers and len(numbers) == len(set(numbers)), f"Invalid spec owners: {lane_id}"
        for number in numbers:
            assert number in specs or number in reserved, f"Unknown spec {number} in {lane_id}"
    for req_id, record in ownership["requirements"].items():
        assert record["primary"] in specs, f"Missing primary spec: {req_id}"
        assert record["lane"] in lanes, f"Missing requirement lane: {req_id}"
        assert record["primary"] in ownership["lanes"][record["lane"]], req_id
    for requirement in requirements:
        for number in requirement["public_anchors"]:
            assert number in specs or number in reserved, f"Unknown public anchor {number}"
        assert ownership["requirements"][requirement["id"]]["primary"] in requirement["public_anchors"], requirement["id"]
    for number in ownership["newSpecs"]:
        assert number in specs, f"Missing new spec {number}"
        for name in ("spec.md", "plan.md", "tasks.md"):
            path = specs[number].parent / name
            assert path.is_file() and path.read_text().strip(), f"Missing/empty {path}"
        assert "Draft / Planned" in specs[number].read_text(), f"New proposal status: {number}"
        assert "[x]" not in (specs[number].parent / "tasks.md").read_text(), number
        assert str(specs[number].relative_to(ROOT / "specs")) in index, number
    edges = set()
    visiting, visited, order = set(), set(), []

    def visit(lane_id):
        assert lane_id not in visiting, f"Cycle at {lane_id}"
        if lane_id in visited:
            return
        visiting.add(lane_id)
        dependencies = lanes[lane_id]["dependsOn"]
        assert len(dependencies) == len(set(dependencies)), f"Duplicate edge: {lane_id}"
        for parent in dependencies:
            assert parent in lanes, f"Unknown prerequisite {parent}"
            edges.add((parent, lane_id))
            visit(parent)
        visiting.remove(lane_id)
        visited.add(lane_id)
        order.append(lane_id)

    for lane_id in lanes:
        visit(lane_id)
    assert_terminal_coverage(lanes, "L24")
    markdown = (ROOT / "docs" / "PRODUCT-COMPLETION.md").read_text()
    diagram = re.search(r"```mermaid\n(.*?)```", markdown, re.S)
    assert diagram, "Missing lane diagram"
    diagram_edges = set(re.findall(r"\b(L\d{2})(?:\[[^\]\n]*\])?\s*-->\s*(L\d{2})", diagram[1]))
    assert edges == diagram_edges, f"Mermaid edge mismatch: {edges ^ diagram_edges}"
    conditional = graph.get("conditionalDependencies", [])
    conditional_edges = {(edge["from"], edge["to"]) for edge in conditional}
    assert len(conditional_edges) == len(conditional), "Duplicate conditional edge"
    assert not conditional_edges & edges, "Conditional edge also unconditional"
    for edge in conditional:
        assert edge["from"] in lanes and edge["to"] in lanes, "Unknown conditional endpoint"
        assert edge.get("when", "").strip(), "Missing dependency condition"
    dashed = set(re.findall(r"\b(L\d{2})\s+-\.\s+[^\n]*?\s+\.->\s*(L\d{2})", diagram[1]))
    assert dashed == conditional_edges, "Conditional Mermaid edge mismatch"
    # Optional slices may be enabled together: their union must also remain acyclic.
    union = edges | conditional_edges
    active, done = set(), set()

    def visit_union(lane_id):
        assert lane_id not in active, f"Conditional cycle at {lane_id}"
        if lane_id in done:
            return
        active.add(lane_id)
        for parent, child in union:
            if child == lane_id:
                visit_union(parent)
        active.remove(lane_id)
        done.add(lane_id)

    for lane_id in lanes:
        visit_union(lane_id)
    print(f"Valid: {len(lanes)} lanes, {len(edges)} edges, {len(req_ids)} requirements, "
          f"{len(conditional_edges)} conditional edges, "
          f"{len(ownership['newSpecs'])} new spec triplets; reserved {', '.join(reserved) or 'none'}")
    print("Topological order: " + " -> ".join(order))
    validate_execution(lanes)


if __name__ == "__main__":
    validate()
