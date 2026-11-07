"""Fewer triangles, by removing vertices. Used by import_tumbler.py. Stdlib only.
Self-check: python3 tools/cat/slim.py

Half-edge collapse under quadric error (Garland & Heckbert): a vertex is removed by
sliding it onto a neighbour. Nothing moves and nothing new is made, so every surviving
vertex keeps its exact colour, UV and skin weights, and no attribute needs resampling.

Edges with one triangle are locked. An exporter splits vertices along UV seams and
hard edges, so those edges and the mesh's open rims all look alike from here, and
holding them still is what keeps seams from cracking open.
"""
import heapq
import math


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _plane_error(q, p):
    """p's summed squared distance to the planes in quadric q."""
    x, y, z = p
    return (q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
            + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
            + q[7] * z * z + 2 * q[8] * z + q[9])


def reduce(positions, triangles, target, normals=None, colours=None, importance=None, tolerance=math.inf, colour_tolerance=math.inf):
    """-> triangles (vertex indices into positions), down to `target` if the locks and
    the tolerance allow. importance[v] multiplies the cost of removing v; math.inf means
    never remove it. tolerance is the farthest a removed vertex's original planes may
    end up from the surface that replaces it. It is a maximum because an average hides
    the damage, and it exists because a triangle budget alone cannot see a silhouette
    going square, and will spend the whole of a smooth skull to reach its number.
    colour_tolerance does the same for painted detail, which is invisible to geometry:
    a flat surface with a dark stripe on it looks free to remove. Neighbours further
    apart than this in any channel are a colour edge, and hold still."""
    count = len(positions)
    alive = [True] * len(triangles)
    tris = [list(t) for t in triangles]
    touching = [set() for _ in range(count)]
    quadrics = [[0.0] * 10 for _ in range(count)]
    absorbed = [[] for _ in range(count)]  # the original planes each vertex answers for
    facing = [None] * len(tris)  # each triangle's original direction
    edge_uses = {}
    for index, (a, b, c) in enumerate(tris):
        for v in (a, b, c):
            touching[v].add(index)
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edge_uses[key] = edge_uses.get(key, 0) + 1
        n = _cross(_sub(positions[b], positions[a]), _sub(positions[c], positions[a]))
        size = math.sqrt(_dot(n, n))
        if size == 0:
            continue
        x, y, z = n[0] / size, n[1] / size, n[2] / size
        facing[index] = (x, y, z)
        d = -(x * positions[a][0] + y * positions[a][1] + z * positions[a][2])
        plane = (x * x, x * y, x * z, x * d, y * y, y * z, y * d, z * z, z * d, d * d)
        for v in (a, b, c):
            q = quadrics[v]
            absorbed[v].append((x, y, z, d))
            for i in range(10):
                q[i] += plane[i]

    locked = [False] * count
    for (u, v), uses in edge_uses.items():
        if uses != 2:
            locked[u] = locked[v] = True
        # A vertex on a colour edge stays too. Each collapse past it could be a match in
        # colour and still widen a sharp stripe's edge into a gradient.
        elif colours and max(abs(a - b) for a, b in zip(colours[u], colours[v])) > colour_tolerance:
            locked[u] = locked[v] = True
    if importance:
        for v in range(count):
            if importance[v] == math.inf:
                locked[v] = True

    def neighbours(v):
        found = set()
        for t in touching[v]:
            found.update(tris[t])
        found.discard(v)
        return found

    def cost(u, v):
        """Removing u by sliding it onto v."""
        p, r = positions[u], positions[v]
        gap = _sub(p, r)
        length2 = _dot(gap, gap)
        error = _plane_error(quadrics[u], r) + 1e-6 * length2  # the small term favours short edges
        if normals:
            error += 0.01 * length2 * max(0.0, 1 - _dot(normals[u], normals[v]))
        if colours:
            shade = [a - b for a, b in zip(colours[u], colours[v])]
            error += 0.04 * length2 * sum(x * x for x in shade)
        return error * (importance[u] if importance else 1)

    version = [0] * count
    heap = []

    def push(v):
        """Queue the cheapest way to remove v. A vertex is one entry, so stale ones die by version."""
        if locked[v]:
            return
        best = None
        for other in neighbours(v):
            c = cost(v, other)
            if best is None or c < best[0]:
                best = (c, other)
        version[v] += 1
        if best:
            heapq.heappush(heap, (best[0], v, best[1], version[v]))

    def within_tolerance(u, v):
        if colours and max(abs(a - b) for a, b in zip(colours[u], colours[v])) > colour_tolerance:
            return False
        x, y, z = positions[v]
        return all(abs(a * x + b * y + c * z + d) <= tolerance for a, b, c, d in absorbed[u])

    def legal(u, v):
        ring_u, ring_v = neighbours(u), neighbours(v)
        if v not in ring_u or len(ring_u & ring_v) != 2:  # would pinch the surface
            return False
        for t in touching[u]:
            tri = tris[t]
            if v in tri:
                continue
            new = [positions[v] if i == u else positions[i] for i in tri]
            after = _cross(_sub(new[1], new[0]), _sub(new[2], new[0]))
            size = math.sqrt(_dot(after, after))
            # Against the original direction, not the last step's: small allowed turns
            # would otherwise add up to a triangle facing backwards. 0.5 is 60 degrees.
            if size == 0 or (facing[t] and _dot(facing[t], after) < 0.5 * size):
                return False
        return True

    for v in range(count):
        push(v)
    remaining = len(tris)
    while remaining > target and heap:
        _, u, v, stamp = heapq.heappop(heap)
        if stamp != version[u] or locked[u]:
            continue
        if not within_tolerance(u, v) or not legal(u, v):
            version[u] += 1  # no retry: it costs little, and only a neighbour's collapse changes this
            continue
        for t in list(touching[u]):
            tri = tris[t]
            if v in tri:
                alive[t] = False
                remaining -= 1
                for w in tri:
                    touching[w].discard(t)
            else:
                tri[tri.index(u)] = v
                touching[v].add(t)
        touching[u].clear()
        q, r = quadrics[v], quadrics[u]
        absorbed[v] += absorbed[u]
        for i in range(10):
            q[i] += r[i]
        locked_now = neighbours(v) | {v}
        for w in locked_now:
            push(w)
    return [tuple(t) for t, keep in zip(tris, alive) if keep]


if __name__ == "__main__":
    # A rumpled sheet: the rim is locked, one interior vertex is protected, and it must
    # come out smaller with nothing folded over.
    size = 40
    grid = [(x / size, y / size, 0.02 * math.sin(x * 0.4) * math.cos(y * 0.3)) for y in range(size + 1) for x in range(size + 1)]
    at = lambda x, y: y * (size + 1) + x
    faces = []
    for y in range(size):
        for x in range(size):
            faces += [(at(x, y), at(x + 1, y), at(x + 1, y + 1)), (at(x, y), at(x + 1, y + 1), at(x, y + 1))]
    keep = at(20, 20)
    weight = [1.0] * len(grid)
    weight[keep] = math.inf
    # And a tolerance has to hold on to the bumps a budget would flatten.
    held = reduce(grid, faces, 0, tolerance=0.0005)
    assert len(faces) // 4 < len(held) < len(faces), f"tolerance gave {len(held)} of {len(faces)}"
    # And painted stripes have to survive on a sheet that is otherwise flat.
    flat = [(x, y, 0.0) for x, y, _ in grid]
    stripes = [(1.0, 1.0, 1.0) if round(p[0] * size) % 16 < 8 else (0.1, 0.1, 0.1) for p in flat]
    painted = reduce(flat, faces, 0, colours=stripes, colour_tolerance=0.05)
    assert len(painted) < len(faces), "nothing was removed from the flat stripes"
    for t in painted:  # a triangle crossing a stripe's edge stays one cell wide, or the colour smears
        if len({stripes[v] for v in t}) > 1:
            xs = [flat[v][0] for v in t]
            assert max(xs) - min(xs) <= 1 / size + 1e-9, "a colour boundary smeared"
    out = reduce(grid, faces, len(faces) // 4, importance=weight)
    used = {v for t in out for v in t}
    rim = {at(i, j) for i in range(size + 1) for j in (0, size)} | {at(j, i) for i in range(size + 1) for j in (0, size)}
    assert len(out) <= len(faces) // 4 + 2, f"stopped early at {len(out)} of {len(faces)}"
    assert rim <= used, "a rim vertex was removed"
    assert keep in used, "a protected vertex was removed"
    assert all(len(set(t)) == 3 for t in out), "a degenerate triangle survived"
    for t in out:
        n = _cross(_sub(grid[t[1]], grid[t[0]]), _sub(grid[t[2]], grid[t[0]]))
        assert n[2] > 0, "a triangle folded over"
    print(f"ok: slim {len(faces)} -> {len(out)} triangles, rim and protected vertex intact")
