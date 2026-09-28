# Cat Ronin, built and animated from code. Run through tools/cat/build.sh:
#   blender -b --factory-startup -P tools/cat/build_cat.py -- <clips.json> <out.glb>
#
# The character is a rigid "puppet": every part is a simple mesh parented to one
# bone, so there is no weight painting to maintain and toon shading stays crisp.
# Animations come from clips.json and are baked into one glTF action per clip.
import json
import math
import sys

import bmesh
import bpy
from mathutils import Euler, Vector
from mathutils.bvhtree import BVHTree

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
    "mouth": (0.45, 0.10, 0.12),
    "scar": (0.85, 0.45, 0.48),
    "leather": (0.055, 0.045, 0.045),
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


def sphere(name, mat, loc, r, scale=(1, 1, 1), segs=24):
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


def tube(name, mat, points, radius, taper=None):
    """A smooth ink stroke: a bevelled Bezier curve through points, as a mesh.
    taper: per-point radius multipliers (ends thinner, like a brush stroke)."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 8
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for i, (bp, p) in enumerate(zip(spline.bezier_points, points)):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
        bp.radius = taper[i] if taper else 1.0
    tmp = bpy.data.objects.new(name + "_curve", curve)
    scene.collection.objects.link(tmp)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return finish(obj, name, mat)


def on_surface(objs, x, z, lift=0.003):
    """Where a ray from straight in front hits the front-most of objs, pulled
    out by `lift`: lets ink features be drawn onto the face, not float near it."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for o in objs:
        tree = BVHTree.FromObject(o, dg)
        inv = o.matrix_world.inverted()
        hit, *_ = tree.ray_cast(inv @ Vector((x, -2.0, z)), (inv.to_3x3() @ Vector((0, 1, 0))).normalized())
        if hit is not None:
            w = o.matrix_world @ hit
            if best is None or w.y < best.y:
                best = w
    if best is None:
        raise ValueError(f"no surface at x={x} z={z}")
    return best + Vector((0, -lift, 0))


def stroke(name, mat, objs, xz, radius, taper=None, lift=0.003):
    return tube(name, mat, [on_surface(objs, x, z, lift) for x, z in xz], radius, taper)


# ── Skeleton. Blender is Z-up; he faces -Y, so his left is +X.
BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.3), None),
    "hips": ((0, 0, 0.55), (0, 0, 0.75), "root"),
    "spine": ((0, 0, 0.75), (0, 0, 1.05), "hips"),
    "head": ((0, 0, 1.05), (0, 0, 1.55), "spine"),
    "ear.L": ((0.24, 0, 1.62), (0.38, 0, 1.84), "head"),
    "ear.R": ((-0.24, 0, 1.62), (-0.38, 0, 1.84), "head"),
    "eye.L": ((0.12, -0.26, 1.34), (0.12, -0.36, 1.34), "head"),  # the open eye; the site aims it at the pointer
    "lid.L": ((0.12, -0.26, 1.34), (0.12, -0.26, 1.44), "head"),  # upper eyelid; the site blinks it
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


# Head: wide at the cheeks with scruffy tufts (after the ink drawing)
part("head", sphere("head", "fur", (0, 0, 1.3), 0.3, (1.14, 1.0, 0.9)))
for side, sx in (("L", 1), ("R", -1)):
    for i, (dz, length) in enumerate(((0.02, 0.14), (-0.06, 0.12), (-0.13, 0.09))):  # cheek tufts
        tip = (0.43 * sx, -0.08 - i * 0.02, 1.2 + dz - length * 0.4)
        part("head", limb(f"cheek_tuft.{side}{i}", "fur_light" if i else "fur", (0.26 * sx, -0.1, 1.22 + dz), tip, 0.05, 0.0))
# Muzzle: two whisker pads, a triangular nose, and a closed cat "w" mouth
for sx in (1, -1):
    part("head", sphere(f"whisker_pad{sx}", "fur_light", (0.055 * sx, -0.25, 1.2), 0.085, (1.0, 0.72, 0.78)))
part("head", sphere("chin", "fur_light", (0, -0.21, 1.13), 0.075, (1.2, 0.8, 0.6)))
nose = cone("nose", "pink", (0, -0.33, 1.25), 0.034, 0.0, 0.03, rot=(math.radians(90), 0, 0), verts=3)
nose.rotation_euler = (math.radians(-90), math.radians(180), 0)  # point down, flat face forward
nose.scale = (1.4, 1.0, 1.0)
part("head", nose)
# Mouth, drawn onto the muzzle: philtrum, then a closed "w" with a slight smirk
# (his left side curls higher).
muzzle = [o for o, _ in PARTS if o.name.startswith(("whisker_pad", "chin"))]
part("head", stroke("philtrum", "ink", muzzle, [(0, 1.236), (0, 1.215), (0, 1.196)], 0.0055))
part("head", stroke("mouth.L", "ink", muzzle, [(0, 1.196), (0.022, 1.182), (0.046, 1.186), (0.068, 1.203)], 0.0055, [1, 1, 0.9, 0.45]))
part("head", stroke("mouth.R", "ink", muzzle, [(0, 1.196), (-0.022, 1.183), (-0.043, 1.187), (-0.058, 1.196)], 0.0055, [1, 1, 0.9, 0.45]))
for side, sx in (("L", 1), ("R", -1)):
    ear = cone(f"ear.{side}", "fur", (0.31 * sx, 0.0, 1.74), 0.14, 0.0, 0.32, rot=(math.radians(-8), math.radians(36 * sx), 0))
    part(f"ear.{side}", ear)
    inner = cone(f"ear_inner.{side}", "pink", (0.31 * sx, -0.055, 1.73), 0.085, 0.0, 0.22, rot=(math.radians(-8), math.radians(36 * sx), 0))
    part(f"ear.{side}", inner)
    for i, dz in enumerate((0.03, 0.0, -0.03)):  # whiskers, fanned
        w = limb(f"whisker.{side}{i}", "ink", (0.12 * sx, -0.29, 1.2 + dz), (0.44 * sx, -0.23, 1.2 + dz * 3.5), 0.0045, 0.0007)
        part("head", w)

# Eye (his left, +X): big yellow-green iris (radial shader on the site), slit
# pupil, two catchlights, and a fur lid with an ink lash line that flicks out at
# the corner. Lid geometry is analytic so the lash can follow its edge exactly.
EYE = Vector((0.12, -0.262, 1.34))
part("head", sphere("eye_white", "eye_white", tuple(EYE), 0.082, (1.0, 0.55, 1.08)))
part("eye.L", sphere("iris", "iris", (0.12, -0.298, 1.34), 0.066, (1.0, 0.42, 1.0)))
part("eye.L", sphere("pupil", "ink", (0.12, -0.324, 1.34), 0.034, (0.28, 0.3, 1.3)))
part("eye.L", sphere("catchlight", "eye_white", (0.098, -0.333, 1.362), 0.013, (1.0, 0.4, 1.0)))
part("eye.L", sphere("catchlight_small", "eye_white", (0.14, -0.331, 1.318), 0.006, (1.0, 0.4, 1.0)))
LID_R, LID_CUT, LID_TILT, LID_SCALE = 0.09, 0.055, math.radians(10), Vector((1.05, 0.8, 1.1))
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=LID_R, location=tuple(EYE))
lid = bpy.context.object
bm = bmesh.new()
bm.from_mesh(lid.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < LID_CUT], context="VERTS")  # keep the top cap
bm.to_mesh(lid.data)
bm.free()
lid.scale = LID_SCALE
lid.rotation_euler = (LID_TILT, 0, 0)  # tipped forward over the top of the eye
part("lid.L", finish(lid, "eyelid", "fur"))


def lid_edge(theta, grow=1.03):
    rho = math.sqrt(LID_R**2 - LID_CUT**2)
    local = Vector((rho * math.cos(theta), rho * math.sin(theta), LID_CUT))
    local = Vector((local.x * LID_SCALE.x, local.y * LID_SCALE.y, local.z * LID_SCALE.z)) * grow
    return EYE + Euler((LID_TILT, 0, 0)).to_matrix() @ local


lash = [lid_edge(math.radians(a)) for a in (196, 222, 250, 278, 306, 334)]
lash.append(lash[-1] + Vector((0.03, 0.004, 0.016)))  # the flick at the outer corner
part("lid.L", tube("lash", "ink", lash, 0.0075, [0.4, 0.9, 1, 1, 1, 0.9, 0.25]))
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.092, depth=0.03, location=(-0.115, -0.3, 1.34), rotation=(math.radians(90), 0, math.radians(-12)))
part("head", finish(bpy.context.object, "eyepatch", "leather"))
# Strap: two strokes on the head's surface, traced by angle around the head
# (azimuth from the front toward his left, elevation up), both disappearing
# under the beanie. A full ring would have to dip below the cheek at the back.
HEAD_C, HEAD_R = Vector((0, 0, 1.3)), Vector((0.342, 0.3, 0.27)) * 1.03


def on_head(az, el):
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
    return HEAD_C + Vector((d.x * HEAD_R.x, d.y * HEAD_R.y, d.z * HEAD_R.z))


part("head", tube("eyepatch_strap.front", "leather", [on_head(az, el) for az, el in ((-10, 16), (8, 25), (30, 33), (48, 38))], 0.012))
part("head", tube("eyepatch_strap.side", "leather", [on_head(az, el) for az, el in ((-38, 8), (-70, 11), (-105, 19), (-140, 32))], 0.012))
# Old scars on his patch side: two scratches drawn onto the head
head_mesh = [o for o, _ in PARTS if o.name == "head"]
part("head", stroke("scar.0", "scar", head_mesh, [(-0.2, 1.425), (-0.235, 1.365), (-0.268, 1.295)], 0.006, [0.3, 1, 0.3]))
part("head", stroke("scar.1", "scar", head_mesh, [(-0.228, 1.43), (-0.262, 1.372), (-0.292, 1.31)], 0.005, [0.3, 1, 0.3]))

# Beanie: slouchy knit crown tipped back, thick folded cuff (ribs come from the shader)
beanie = sphere("beanie", "beanie", (0, 0.05, 1.54), 0.31, (1.1, 1.08, 1.08))
beanie.rotation_euler = (math.radians(-10), math.radians(6), 0)
part("head", beanie)
part("head", torus("beanie_cuff", "beanie", (0, 0.01, 1.5), 0.3, 0.06, scale=(1.1, 1.03, 1.05)))

# Torso: lean flannel shirt, open V collar showing the cream chest
part("spine", cone("torso", "flannel", (0, 0, 0.88), 0.21, 0.17, 0.44))
part("spine", cone("chest", "fur_light", (0, -0.155, 0.99), 0.1, 0.0, 0.2, rot=(math.radians(180), 0, 0), verts=3))  # V of the open collar
for sx in (1, -1):  # collar points
    part("spine", cone(f"collar{sx}", "flannel", (0.07 * sx, -0.15, 1.06), 0.05, 0.0, 0.1, rot=(math.radians(200), math.radians(-35 * sx), 0), verts=3))

# Hakama: waist, sash, and one wide trouser leg per leg bone
part("hips", cone("hakama_waist", "hakama", (0, 0, 0.6), 0.23, 0.2, 0.18))
part("hips", torus("sash", "sash", (0, 0, 0.68), 0.21, 0.035))
for side, sx in (("L", 1), ("R", -1)):
    part(f"leg.{side}", limb(f"hakama_leg.{side}", "hakama", (0.11 * sx, 0, 0.6), (0.16 * sx, 0, 0.14), 0.11, 0.17))
    part(f"leg.{side}", sphere(f"foot.{side}", "fur", (0.15 * sx, -0.07, 0.06), 0.08, (1.0, 1.35, 0.6)))
    for i, dx in enumerate((-0.04, 0.0, 0.04)):  # toes
        part(f"leg.{side}", sphere(f"toe.{side}{i}", "fur", (0.15 * sx + dx, -0.17, 0.05), 0.028))

# Arms: rolled, frayed flannel sleeves; grey fur forearms and paws
for side, sx in (("L", 1), ("R", -1)):
    ua = BONES[f"upper_arm.{side}"]
    fa = BONES[f"forearm.{side}"]
    part(f"upper_arm.{side}", limb(f"sleeve_upper.{side}", "flannel", ua[0], ua[1], 0.08, 0.08))
    mid = tuple(Vector(fa[0]).lerp(Vector(fa[1]), 0.45))
    part(f"forearm.{side}", limb(f"sleeve_cuff.{side}", "flannel", fa[0], mid, 0.08, 0.095))
    part(f"forearm.{side}", limb(f"forearm_fur.{side}", "fur", mid, fa[1], 0.055, 0.06))
    part(f"forearm.{side}", sphere(f"paw.{side}", "fur", tuple(Vector(fa[1]) + Vector((0, 0, -0.035))), 0.07))

# Tail: bushy, cream tip
for i in (1, 2, 3):
    h, t, _ = BONES[f"tail.{i}"]
    part(f"tail.{i}", limb(f"tail.{i}", "fur", h, t, 0.07 - i * 0.006, 0.065 - i * 0.006))
part("tail.3", sphere("tail_tip", "fur_light", BONES["tail.3"][1], 0.06))

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
#    channel: [[frame, value], ...] keys, eased between; or {"sin": [amp, cycles, phase, offset?]}
#    sampled over the clip so loops close exactly.
#    "base": another clip whose tracks this one inherits, channel by channel, so a
#    gesture can be layered on a pose ("sit_present" = "present" on "sit").
#    The lab (tools/cat/lab.js) uses the same convention, so poses copy across.
clips = json.load(open(CLIPS_PATH))
by_name = {c["name"]: c for c in clips}


def resolved_tracks(clip):
    if "base" not in clip:
        return clip["tracks"]
    tracks = {bone: dict(ch) for bone, ch in resolved_tracks(by_name[clip["base"]]).items()}
    for bone, channels in clip["tracks"].items():
        tracks.setdefault(bone, {}).update(channels)
    return tracks

rig.animation_data_create()
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"


def value_at(channel, f, length):
    if isinstance(channel, dict):
        amp, cycles, phase, *offset = channel["sin"]
        return amp * math.sin(2 * math.pi * (cycles * f / length + phase)) + (offset[0] if offset else 0)
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
    for bone, channels in resolved_tracks(clip).items():
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
    print(f"clip {name}: {length} frames, {len(resolved_tracks(clip))} bones")
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
