"""Fail loudly if the exported GLB is missing clips, bones or materials the site uses.
The export command can "succeed" and still write an empty or partial file."""
import json
import struct
import sys

glb, clips_path = sys.argv[1], sys.argv[2]
data = open(glb, "rb").read()
magic, _, length = struct.unpack_from("<III", data, 0)
assert magic == 0x46546C67, "not a GLB file"
chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
assert chunk_type == 0x4E4F534A, "first chunk is not JSON"
gltf = json.loads(data[20 : 20 + chunk_len])

want_clips = {c["name"] for c in json.load(open(clips_path))}
have_clips = {a["name"] for a in gltf.get("animations", [])}
nodes = {n.get("name") for n in gltf["nodes"]}
mats = {m["name"] for m in gltf.get("materials", [])}

missing = {
    "clips": want_clips - have_clips,
    "bones": {"root", "head", "eye.L", "upper_arm.L", "tail.3"} - nodes,
    "materials": {"fur", "flannel", "beanie", "iris", "ink", "hakama"} - mats,
}
problems = {k: sorted(v) for k, v in missing.items() if v}
assert not problems, f"GLB incomplete: {problems}"
print(f"ok: {len(data) // 1024} KB, {len(have_clips)} clips {sorted(have_clips)}, {len(gltf['meshes'])} meshes, {len(mats)} materials")
