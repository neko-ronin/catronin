"""Dress Tumbler's Cat Ronin for the site: its model, the site's motion.
  python3 tools/cat/import_tumbler.py <tumbler ronin.glb> <clips.glb> <out.glb>

clips.glb is what build_cat.py exports from clips.json. Only its animations are
used. His sword and the clip that draws it are in sword.py. Stdlib only, on
purpose: the GLB is plain JSON plus a binary chunk.

A clip stores each bone's rotation relative to its parent, and Tumbler's bones
rest differently (arms, ears, tail), so copying keys would bend him wrongly.
What must survive is each bone's turn away from rest in the character's own axes:
    D = W_rest * R_rest^-1 * q * W_rest^-1
which is also the frame build_cat.py and aim-layer.js pose in. Deltas in that
frame multiply straight down a chain, so equal deltas give equal poses whatever
the rest orientations are. verify() proves it by walking both skeletons.
"""
import json
import math
import re
import struct
import sys

# Tumbler's game swaps the eyepatches at runtime and straps its katana to a chest
# harness. The site shows one eyepatch and wears sword.py's katana at the waist.
UNWORN = re.compile(r"^eyepatch\.(round|almond|shield)|^blade(_edge)?\.|^katana_|^harness_|^holster")
# Three tail bones become seven: each share turns its bones equally, so the
# whole tail still curls by the same total.
TAIL = {"tail.1": ["tail.1", "tail.2"], "tail.2": ["tail.3", "tail.4"], "tail.3": ["tail.5", "tail.6", "tail.7"]}
# ronin-director.js drives these per frame, for this model's own lid range.
DIRECTED = {"eye.L", "lid.L"}


def read_glb(path):
    data = open(path, "rb").read()
    assert struct.unpack_from("<I", data)[0] == 0x46546C67, f"{path}: not a GLB"
    size = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + size]), data[20 + size + 8 :]


def floats(glb, index):
    gltf, blob = glb
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
    assert acc["componentType"] == 5126, "animation data is expected to be floats"
    at = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    step = view.get("byteStride") or 4 * width
    return [struct.unpack_from(f"<{width}f", blob, at + i * step) for i in range(acc["count"])]


# ── Quaternions, (x, y, z, w) as in glTF ──
def mul(a, b):
    x, y, z, w = a
    X, Y, Z, W = b
    return (w * X + x * W + y * Z - z * Y, w * Y - x * Z + y * W + z * X, w * Z + x * Y - y * X + z * W, w * W - x * X - y * Y - z * Z)


def inv(q):
    return (-q[0], -q[1], -q[2], q[3])


def power(q, t):
    """The same rotation about the same axis, t of the way."""
    if q[3] < 0:
        q = tuple(-v for v in q)
    half = math.acos(min(1, q[3]))
    if half < 1e-7:
        return (0, 0, 0, 1)
    s = math.sin(half * t) / math.sin(half)
    return (q[0] * s, q[1] * s, q[2] * s, math.cos(half * t))


def degrees_apart(a, b):
    # atan2, not acos: acos of a float32 dot product cannot resolve small angles.
    x, y, z, w = mul(a, inv(b))
    return math.degrees(2 * math.atan2(math.sqrt(x * x + y * y + z * z), abs(w)))


class Rig:
    """Rest pose of one file's nodes, by name. Bones win over same-named meshes."""

    def __init__(self, gltf):
        self.nodes = gltf["nodes"]
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get("children", [])}
        joints = set(gltf["skins"][0]["joints"])
        self.index = {}
        for i, n in enumerate(self.nodes):
            if i in joints or n["name"] not in self.index:
                self.index[n["name"]] = i

    def rest(self, name):
        return tuple(self.nodes[self.index[name]].get("rotation", (0, 0, 0, 1)))

    def offset(self, name):
        return tuple(self.nodes[self.index[name]].get("translation", (0, 0, 0)))

    def world(self, name):
        i, q = self.index[name], (0, 0, 0, 1)
        while i is not None:
            q = mul(tuple(self.nodes[i].get("rotation", (0, 0, 0, 1))), q)
            i = self.parent.get(i)
        return q

    def chain(self, name):
        """Bone names from the root down to `name`."""
        i, names = self.index[name], []
        while i is not None:
            names.append(self.nodes[i]["name"])
            i = self.parent.get(i)
        return names[::-1]


def retarget(source, source_rig, target_rig):
    """-> {clip name: {(bone, path): (times, values)}} on the target rig."""
    clips = {}
    for anim in source[0]["animations"]:
        tracks = {}
        for channel in anim["channels"]:
            name = source[0]["nodes"][channel["target"]["node"]]["name"]
            path = channel["target"]["path"]
            if name in DIRECTED or name not in target_rig.index:
                continue
            sampler = anim["samplers"][channel["sampler"]]
            times = floats(source, sampler["input"])
            values = floats(source, sampler["output"])
            if path == "translation" and max(max(abs(a - b) for a, b in zip(v, values[0])) for v in values) > 1e-5:
                moved = target_rig.offset(name)
                rest = source_rig.offset(name)
                tracks[name, path] = (times, [tuple(m + v - r for m, v, r in zip(moved, value, rest)) for value in values])
            elif path == "rotation":
                w, r = source_rig.world(name), source_rig.rest(name)
                deltas = [mul(mul(w, mul(inv(r), q)), inv(w)) for q in values]
                shares = TAIL.get(name, [name])
                for bone in shares:
                    w2, r2 = target_rig.world(bone), target_rig.rest(bone)
                    tracks[bone, path] = (times, unbroken([mul(r2, mul(mul(inv(w2), power(d, 1 / len(shares))), w2)) for d in deltas]))
        clips[anim["name"]] = tracks
    return clips


def unbroken(quaternions):
    """q and -q are one rotation; keep neighbours on the same side so keys interpolate short."""
    out = []
    for q in quaternions:
        if out and sum(a * b for a, b in zip(out[-1], q)) < 0:
            q = tuple(-v for v in q)
        out.append(q)
    return out


def verify(source, source_rig, target_rig, clips):
    """Walk both skeletons and compare posed bones: an independent route to the delta."""
    worst = 0
    for anim in source[0]["animations"]:
        pose = {}
        for channel in anim["channels"]:
            if channel["target"]["path"] == "rotation":
                pose[source[0]["nodes"][channel["target"]["node"]]["name"]] = floats(source, anim["samplers"][channel["sampler"]]["output"])
        at = lambda track, f: track[round(f * (len(track) - 1))]
        for f in (0, 0.25, 0.5, 0.75, 1):
            for name, bone in [(b, b) for b in pose if b not in DIRECTED and b not in TAIL] + [("tail.3", "tail.7")]:
                seen = (0, 0, 0, 1)
                for link in source_rig.chain(name):
                    seen = mul(seen, at(pose[link], f) if link in pose else source_rig.rest(link))
                seen = mul(seen, inv(source_rig.world(name)))
                got = (0, 0, 0, 1)
                for link in target_rig.chain(bone):
                    track = clips[anim["name"]].get((link, "rotation"))
                    got = mul(got, at(track[1], f) if track else target_rig.rest(link))
                got = mul(got, inv(target_rig.world(bone)))
                off = degrees_apart(seen, got)
                worst = max(worst, off)
                assert off < 0.05, f"{anim['name']} {bone} at {f}: {off:.3f} deg from the site's pose"
    return worst


def main(tumbler_path, clips_path, out_path):
    target, source = read_glb(tumbler_path), read_glb(clips_path)
    gltf, blob = target
    source_rig, target_rig = Rig(source[0]), Rig(gltf)
    clips = retarget(source, source_rig, target_rig)
    worst = verify(source, source_rig, target_rig, clips)

    # Unworn parts are all leaves, so nothing hangs off what goes.
    keep = [i for i, n in enumerate(gltf["nodes"]) if not ("mesh" in n and UNWORN.match(n["name"]))]
    node_map = {old: new for new, old in enumerate(keep)}
    nodes = [gltf["nodes"][i] for i in keep]
    bones = {gltf["nodes"][j]["name"] for j in gltf["skins"][0]["joints"]}
    for n in nodes:
        if "children" in n:
            n["children"] = [node_map[c] for c in n["children"] if c in node_map]
        # three looks bones up by name, and would find a same-named mesh first.
        if "mesh" in n and n["name"] in bones:
            n["name"] += ".mesh"
    for skin in gltf["skins"]:
        skin["joints"] = [node_map[j] for j in skin["joints"]]
        if "skeleton" in skin:
            skin["skeleton"] = node_map[skin["skeleton"]]
    for scene in gltf["scenes"]:
        scene["nodes"] = [node_map[i] for i in scene["nodes"]]

    used_meshes = sorted({n["mesh"] for n in nodes if "mesh" in n})
    bone_at = {nodes[i]["name"]: i for i in range(len(nodes))}
    mesh_map = {old: new for new, old in enumerate(used_meshes)}
    meshes = [gltf["meshes"][i] for i in used_meshes]
    for n in nodes:
        if "mesh" in n:
            n["mesh"] = mesh_map[n["mesh"]]
    used_materials = sorted({p["material"] for m in meshes for p in m["primitives"]})
    material_map = {old: new for new, old in enumerate(used_materials)}
    materials = [gltf["materials"][i] for i in used_materials]
    for m in meshes:
        for p in m["primitives"]:
            p["material"] = material_map[p["material"]]
            p.pop("extras", None)

    # Rewrite the binary chunk with only what is still reachable.
    out = bytearray()
    views, accessors, view_map, accessor_map = [], [], {}, {}

    def copy_view(index):
        if index not in view_map:
            view = dict(gltf["bufferViews"][index])
            start = view.get("byteOffset", 0)
            out.extend(b"\0" * (-len(out) % 4))
            view["byteOffset"] = len(out)
            view["buffer"] = 0
            out.extend(blob[start : start + view["byteLength"]])
            view_map[index] = len(views)
            views.append(view)
        return view_map[index]

    def copy_accessor(index):
        if index not in accessor_map:
            accessor = dict(gltf["accessors"][index])
            accessor["bufferView"] = copy_view(accessor["bufferView"])
            accessor_map[index] = len(accessors)
            accessors.append(accessor)
        return accessor_map[index]

    def add_floats(rows, kind, bounds=False):
        out.extend(b"\0" * (-len(out) % 4))
        at = len(out)
        for row in rows:
            out.extend(struct.pack(f"<{len(row)}f", *row))
        views.append({"buffer": 0, "byteOffset": at, "byteLength": len(out) - at})
        accessor = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(rows), "type": kind}
        if bounds:
            accessor["min"] = [min(r[i] for r in rows) for i in range(len(rows[0]))]
            accessor["max"] = [max(r[i] for r in rows) for i in range(len(rows[0]))]
        accessors.append(accessor)
        return len(accessors) - 1

    for mesh in meshes:
        for p in mesh["primitives"]:
            p["attributes"] = {k: copy_accessor(v) for k, v in p["attributes"].items()}
            p["indices"] = copy_accessor(p["indices"])
    for skin in gltf["skins"]:
        skin["inverseBindMatrices"] = copy_accessor(skin["inverseBindMatrices"])
    for image in gltf.get("images", []):
        image["bufferView"] = copy_view(image["bufferView"])

    # The katana: one material, its colours on the vertices, three meshes.
    def add_sword_mesh(name, mesh):
        ints = len(out) + (-len(out) % 4)
        out.extend(b"\0" * (ints - len(out)))
        out.extend(struct.pack(f"<{len(mesh.indices)}I", *mesh.indices))
        views.append({"buffer": 0, "byteOffset": ints, "byteLength": len(out) - ints})
        accessors.append({"bufferView": len(views) - 1, "componentType": 5125, "count": len(mesh.indices), "type": "SCALAR"})
        indices = len(accessors) - 1
        attributes = {
            "POSITION": add_floats(mesh.positions, "VEC3", True),
            "NORMAL": add_floats(mesh.normals, "VEC3"),
            "COLOR_0": add_floats(mesh.colours, "VEC3"),
        }
        meshes.append({"name": name, "primitives": [{"attributes": attributes, "indices": indices, "material": len(materials)}]})
        return len(meshes) - 1

    blade, hilt, scabbard = add_sword_mesh("sword_blade", sword.blade_mesh()), add_sword_mesh("sword_hilt", sword.hilt_mesh()), add_sword_mesh("saya", sword.scabbard_mesh())
    materials.append({"name": "sword", "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 0.5}})

    def add_node(parent, **node):
        nodes.append(node)
        nodes[bone_at[parent]].setdefault("children", []).append(len(nodes) - 1)
        bone_at[node["name"]] = len(nodes) - 1
        return len(nodes) - 1

    at, turn = sword.worn()
    add_node("hips", name="saya", mesh=scabbard, translation=list(at), rotation=list(turn))
    add_node("hips", name="sword.sheathed", translation=list(at), rotation=list(turn))
    add_node("sword.sheathed", name="sword_hilt", mesh=hilt)
    add_node("forearm.L", name="sword.drawn", translation=[0, 0.2, 0], scale=[0.001] * 3)
    add_node("sword.drawn", name="sword_blade", mesh=blade)
    add_node("sword.drawn", name="sword_hilt_drawn", mesh=hilt)

    clips["sit_draw"], reach_error = sword.author_draw(target_rig, clips["sit"])

    animations = []
    for name, tracks in clips.items():
        anim = {"name": name, "channels": [], "samplers": []}
        for (bone, path), (times, values) in tracks.items():
            kind = {"rotation": "VEC4", "translation": "VEC3", "scale": "VEC3"}[path]
            anim["channels"].append({"sampler": len(anim["samplers"]), "target": {"node": bone_at[bone], "path": path}})
            anim["samplers"].append({"input": add_floats(times, "SCALAR", True), "output": add_floats(values, kind), "interpolation": "LINEAR"})
        animations.append(anim)

    out.extend(b"\0" * (-len(out) % 4))
    gltf.update(nodes=nodes, meshes=meshes, materials=materials, accessors=accessors, bufferViews=views, animations=animations, buffers=[{"byteLength": len(out)}])
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(out)))
        f.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        f.write(struct.pack("<II", len(out), 0x004E4942) + out)
    print(f"imported: {len(out) // 1024} KB binary, {len(meshes)} meshes, {len(clips)} clips, worst pose error {worst:.4f} deg, paw {reach_error * 1000:.1f} mm off the hilt")


if __name__ == "__main__":
    # sword.py imports this file's helpers, which must be this module, not a second copy.
    sys.modules["import_tumbler"] = sys.modules["__main__"]
    import sword

    main(*sys.argv[1:])
