# Cat Ronin, built and animated from code. Run through tools/cat/build.sh:
#   blender -b --factory-startup -P tools/cat/build_cat.py -- <clips.json> <out.glb>
#
# The character is a rigid "puppet": every part is a simple mesh parented to one
# bone, so there is no weight painting to maintain and toon shading stays crisp.
# Animations come from clips.json and are baked into one glTF action per clip.
import json
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
CLIPS_PATH, OUT_PATH = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24

# ── Materials: plain base colours. The site swaps them for toon materials by
#    name, so names are the contract (see src/home/ronin.js).
PALETTE = {
    "fur": (0.44, 0.44, 0.45),
    "fur_light": (0.86, 0.84, 0.80),
    "pink": (0.93, 0.55, 0.58),
    "eye_white": (0.97, 0.96, 0.90),
    "iris": (0.80, 0.82, 0.35),
    "ink": (0.05, 0.05, 0.06),
    "beanie": (0.85, 0.62, 0.18),
    "flannel": (0.66, 0.12, 0.13),
    "hakama": (0.16, 0.20, 0.33),
    "sash": (0.10, 0.12, 0.20),
    "wood": (0.42, 0.26, 0.14),
    "gold": (0.78, 0.60, 0.25),
}
MATS = {}
for name, rgb in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1)
    MATS[name] = m


def finish(obj, name, mat, smooth=True):
    obj.name = name
    obj.data.materials.append(MATS[mat])
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def sphere(name, mat, loc, r, scale=(1, 1, 1), segs=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    return finish(o, name, mat)


def cone(name, mat, loc, r1, r2, depth, rot=(0, 0, 0), verts=32):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.object, name, mat)


def torus(name, mat, loc, major, minor, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=48, minor_segments=12, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = scale
    return finish(o, name, mat)


def limb(name, mat, p0, p1, r0, r1=None):
    """A tapered cylinder running from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r0, radius2=r1 if r1 is not None else r0, depth=d.length, location=(p0 + p1) / 2)
    o = bpy.context.object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finish(o, name, mat)


# ── Skeleton. Blender is Z-up; he faces -Y, so his left is +X.
BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.3), None),
    "hips": ((0, 0, 0.55), (0, 0, 0.75), "root"),
    "spine": ((0, 0, 0.75), (0, 0, 1.05), "hips"),
    "head": ((0, 0, 1.05), (0, 0, 1.55), "spine"),
    "ear.L": ((0.2, 0, 1.5), (0.32, 0, 1.7), "head"),
    "ear.R": ((-0.2, 0, 1.5), (-0.32, 0, 1.7), "head"),
    "eye.L": ((0.11, -0.2, 1.33), (0.11, -0.3, 1.33), "head"),  # the open eye; tracks the pointer later
    "upper_arm.L": ((0.22, 0, 0.98), (0.34, -0.02, 0.8), "spine"),
    "forearm.L": ((0.34, -0.02, 0.8), (0.42, -0.06, 0.62), "upper_arm.L"),
    "upper_arm.R": ((-0.22, 0, 0.98), (-0.34, -0.02, 0.8), "spine"),
    "forearm.R": ((-0.34, -0.02, 0.8), (-0.42, -0.06, 0.62), "upper_arm.R"),
    "leg.L": ((0.12, 0, 0.6), (0.13, 0, 0.08), "hips"),
    "leg.R": ((-0.12, 0, 0.6), (-0.13, 0, 0.08), "hips"),
    "tail.1": ((0, 0.16, 0.62), (0, 0.32, 0.58), "hips"),
    "tail.2": ((0, 0.32, 0.58), (0, 0.46, 0.68), "tail.1"),
    "tail.3": ((0, 0.46, 0.68), (0, 0.52, 0.86), "tail.2"),
}
arm_data = bpy.data.armatures.new("RoninRig")
rig = bpy.data.objects.new("Ronin", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (h, t, parent) in BONES.items():
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = h, t
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# ── Body parts: (mesh, bone). Proportions follow the ink illustration: big head,
#    small body, wide hakama.
PARTS = []


def part(bone, obj):
    PARTS.append((obj, bone))
    return obj


# Head
part("head", sphere("head", "fur", (0, 0, 1.3), 0.3, (1.12, 1.0, 0.92)))
part("head", sphere("muzzle", "fur_light", (0, -0.24, 1.21), 0.11, (1.35, 0.75, 0.72)))
part("head", sphere("nose", "pink", (0, -0.325, 1.255), 0.03, (1.3, 0.8, 0.8)))
part("head", sphere("mouth", "ink", (0, -0.31, 1.17), 0.035, (1.4, 0.5, 0.5)))
for side, sx in (("L", 1), ("R", -1)):
    ear = cone(f"ear.{side}", "fur", (0.27 * sx, 0.0, 1.6), 0.13, 0.0, 0.27, rot=(0, math.radians(34 * sx), 0))
    part(f"ear.{side}", ear)
    inner = cone(f"ear_inner.{side}", "pink", (0.27 * sx, -0.05, 1.59), 0.08, 0.0, 0.19, rot=(0, math.radians(34 * sx), 0))
    part(f"ear.{side}", inner)
    for i, dz in enumerate((0.02, -0.02)):  # whiskers
        w = limb(f"whisker.{side}{i}", "ink", (0.11 * sx, -0.28, 1.2 + dz), (0.36 * sx, -0.25, 1.2 + dz * 3), 0.004)
        part("head", w)

# Eye (his left, +X) and eyepatch (his right, -X)
part("head", sphere("eye_white", "eye_white", (0.11, -0.265, 1.34), 0.075, (1.0, 0.55, 1.1)))
part("eye.L", sphere("iris", "iris", (0.11, -0.3, 1.34), 0.045, (1.0, 0.45, 1.0)))
part("eye.L", sphere("pupil", "ink", (0.11, -0.318, 1.34), 0.022, (0.7, 0.4, 1.2)))
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.095, depth=0.03, location=(-0.11, -0.3, 1.34), rotation=(math.radians(90), 0, math.radians(-12)))
part("head", finish(bpy.context.object, "eyepatch", "ink"))
# Strap: a great circle from the patch diagonally up across the forehead, under the
# beanie on the far side. Its lower half runs behind the head, out of view.
patch, over = Vector((-0.11, -0.3, 0.05)), Vector((0.25, -0.12, 0.2))
strap = torus("eyepatch_strap", "ink", (0, 0, 1.3), 0.325, 0.013)
strap.rotation_mode = "QUATERNION"
strap.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(patch.cross(over).normalized())
strap.scale = (1.09, 1.09, 1.09)
part("head", strap)

# Beanie: crown + ribbed cuff, pulled over the ears' base
part("head", sphere("beanie", "beanie", (0, 0.03, 1.49), 0.31, (1.1, 1.05, 1.02)))
part("head", torus("beanie_cuff", "beanie", (0, 0.01, 1.46), 0.3, 0.05, scale=(1.1, 1.03, 1.0)))

# Torso in flannel, cream chest tuft
part("spine", cone("torso", "flannel", (0, 0, 0.88), 0.25, 0.19, 0.42))
part("spine", sphere("chest_tuft", "fur_light", (0, -0.15, 1.04), 0.07, (1.3, 0.35, 0.8)))

# Hakama: waist, sash, and one wide trouser leg per leg bone
part("hips", cone("hakama_waist", "hakama", (0, 0, 0.6), 0.26, 0.25, 0.18))
part("hips", torus("sash", "sash", (0, 0, 0.68), 0.25, 0.035))
for side, sx in (("L", 1), ("R", -1)):
    part(f"leg.{side}", limb(f"hakama_leg.{side}", "hakama", (0.12 * sx, 0, 0.6), (0.15 * sx, 0, 0.12), 0.12, 0.16))
    part(f"leg.{side}", sphere(f"foot.{side}", "fur", (0.14 * sx, -0.06, 0.06), 0.08, (1.0, 1.4, 0.6)))

# Arms: flannel sleeves, grey paws
for side, sx in (("L", 1), ("R", -1)):
    ua = BONES[f"upper_arm.{side}"]
    fa = BONES[f"forearm.{side}"]
    part(f"upper_arm.{side}", limb(f"sleeve_upper.{side}", "flannel", ua[0], ua[1], 0.075, 0.07))
    part(f"forearm.{side}", limb(f"sleeve_lower.{side}", "flannel", fa[0], fa[1], 0.07, 0.078))
    part(f"forearm.{side}", sphere(f"paw.{side}", "fur", tuple(Vector(fa[1]) + Vector((0, 0, -0.03))), 0.07))

# Tail
for i in (1, 2, 3):
    h, t, _ = BONES[f"tail.{i}"]
    part(f"tail.{i}", limb(f"tail.{i}", "fur", h, t, 0.055 - i * 0.008, 0.05 - i * 0.008))
part("tail.3", sphere("tail_tip", "fur_light", BONES["tail.3"][1], 0.045))

# Katana, sheathed and tucked in the sash at his left hip
part("hips", limb("saya", "ink", (0.2, -0.24, 0.72), (0.34, 0.5, 0.52), 0.022))
part("hips", limb("tsuka", "wood", (0.2, -0.24, 0.72), (0.15, -0.46, 0.78), 0.024))
part("hips", torus("tsuba", "gold", (0.2, -0.25, 0.72), 0.04, 0.012, rot=(math.radians(78), 0, math.radians(10))))

# Parent every part to its bone without moving it.
bpy.context.view_layer.update()
for obj, bone in PARTS:
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world

# ── Animation clips from clips.json
#    tracks: { bone: { "pitch"|"yaw"|"roll"|"lift": channel } }
#    Rotations are in degrees about the CHARACTER's axes, identical for every bone:
#      pitch = about his side-to-side axis (nod, swing an arm forward)
#      yaw   = about the vertical axis (turn to look)
#      roll  = about the front-to-back axis (tilt, raise an arm out sideways)
#    "lift" moves the bone up, in metres (root only in practice).
#    channel: [[frame, value], ...] keys, eased between; or {"sin": [amp, cycles, phase]}
#    sampled over the clip so loops close exactly.
#    The lab (tools/cat/lab.js) uses the same convention, so poses copy across.
clips = json.load(open(CLIPS_PATH))
rig.animation_data_create()
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"


def value_at(channel, f, length):
    if isinstance(channel, dict):
        amp, cycles, phase = channel["sin"]
        return amp * math.sin(2 * math.pi * (cycles * f / length + phase))
    if f <= channel[0][0]:
        return channel[0][1]
    for (f0, v0), (f1, v1) in zip(channel, channel[1:]):
        if f <= f1:
            t = (f - f0) / (f1 - f0)
            return v0 + (v1 - v0) * t * t * (3 - 2 * t)  # ease in and out
    return channel[-1][1]


def local_rotation(pb, pitch, yaw, roll):
    """Character-axis rotation -> the bone's own rest frame."""
    world = Euler((math.radians(pitch), math.radians(roll), math.radians(yaw)), "XYZ").to_matrix()
    rest = pb.bone.matrix_local.to_3x3()
    return (rest.inverted() @ world @ rest).to_quaternion()


for clip in clips:
    name, length = clip["name"], clip["frames"]
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action.use_frame_range = True
    action.frame_start, action.frame_end = 0, length
    action.use_cyclic = clip.get("loop", False)
    rig.animation_data.action = action
    for pb in rig.pose.bones:  # every clip starts from rest
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    for bone, channels in clip["tracks"].items():
        pb = rig.pose.bones[bone]
        up = pb.bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, 1))
        for f in range(length + 1):  # every frame: the exporter samples per frame anyway
            v = {k: value_at(c, f, length) for k, c in channels.items()}
            if {"pitch", "yaw", "roll"} & v.keys():
                pb.rotation_quaternion = local_rotation(pb, v.get("pitch", 0), v.get("yaw", 0), v.get("roll", 0))
                pb.keyframe_insert("rotation_quaternion", frame=f)
            if "lift" in v:
                pb.location = up * v["lift"]
                pb.keyframe_insert("location", frame=f)
    print(f"clip {name}: {length} frames, {len(clip['tracks'])} bones")
rig.animation_data.action = None

bpy.ops.export_scene.gltf(
    filepath=OUT_PATH,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_yup=True,
    export_apply=True,
)
print(f"exported {OUT_PATH}")
