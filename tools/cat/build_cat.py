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
#    Values are linear. The cat is a warm oatmeal against a near-black night, and
#    a neutral grey here reads cold and dies into the background; the hakama is
#    pushed darker and bluer so the legs sit a clear step below the fur instead
#    of merging with it.
PALETTE = {
    "fur": (0.575, 0.525, 0.465),
    "fur_light": (0.90, 0.87, 0.80),
    "pink": (0.95, 0.56, 0.58),
    "mouth": (0.42, 0.09, 0.11),
    "scar": (0.86, 0.44, 0.46),
    "leather": (0.055, 0.042, 0.042),
    "eye_white": (0.98, 0.96, 0.90),
    "iris": (0.80, 0.82, 0.35),
    "ink": (0.05, 0.05, 0.06),
    "beanie": (0.82, 0.55, 0.13),
    "flannel": (0.62, 0.10, 0.10),
    "hakama": (0.145, 0.180, 0.300),
    "sash": (0.10, 0.115, 0.205),
    "wood": (0.40, 0.24, 0.12),
    "gold": (0.80, 0.60, 0.24),
    # Muted, so the hat stops being the loudest thing on him. At full marigold
    # it was the first thing the eye landed on at hero size, ahead of the face.
    "beanie": (0.68, 0.475, 0.175),
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


def sweep(name, mat, path, radii, verts=56, pleats=0, amp=0.0, phase=0.0,
          hem_drop=0.0, cap_start=True, cap_end=True, smooth=True):
    """Ring-swept tube along `path` with a real radius curve, optional radial
    pleats and an optional scalloped hem.

    limb()/cone() can only ever give a straight cone between two points with
    r1 -> r2, which is why the hakama shows facets, the tail shows a seam and the
    cheek tufts read as paper triangles. Everything below is one of these."""
    n = len(path)
    vs, fs = [], []
    for i, (c, r) in enumerate(zip(path, radii)):
        if i == 0:
            d = path[1] - path[0]
        elif i == n - 1:
            d = path[-1] - path[-2]
        else:
            d = path[i + 1] - path[i - 1]
        d = d.normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        v = u.cross(d).normalized()
        for j in range(verts):
            th = 2 * math.pi * j / verts
            lobe = math.cos(pleats * th + phase) if pleats else 0.0
            rr = r * (1.0 + amp * lobe)
            p = c + u * (rr * math.cos(th)) + v * (rr * math.sin(th))
            if hem_drop and i == n - 1 and pleats:  # pleat ridges hang lower
                p = p + d * (hem_drop * (0.5 + 0.5 * lobe))
            vs.append(tuple(p))
    for i in range(n - 1):
        for j in range(verts):
            a, b = i * verts + j, i * verts + (j + 1) % verts
            fs.append((a, b, b + verts, a + verts))
    if cap_start:
        vs.append(tuple(path[0]))
        c0 = len(vs) - 1
        for j in range(verts):
            fs.append((c0, (j + 1) % verts, j))
    if cap_end:
        vs.append(tuple(path[-1]))
        c1 = len(vs) - 1
        base = (n - 1) * verts
        for j in range(verts):
            fs.append((c1, base + j, base + (j + 1) % verts))
    me = bpy.data.meshes.new(name)
    me.from_pydata(vs, [], fs)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # ring sweep winding is not worth hand-deriving
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return finish(ob, name, mat, smooth=smooth)


# ── Skeleton. Blender is Z-up; he faces -Y, so his left is +X.
BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.3), None),
    "hips": ((0, 0, 0.55), (0, 0, 0.75), "root"),
    "spine": ((0, 0, 0.75), (0, 0, 1.05), "hips"),
    "head": ((0, 0, 1.05), (0, 0, 1.55), "spine"),
    "ear.L": ((0.24, 0, 1.62), (0.38, 0, 1.84), "head"),
    "ear.R": ((-0.24, 0, 1.62), (-0.38, 0, 1.84), "head"),
    # The open eye. Its pivot sits behind the eye, at the eye-white's centre of
    # curvature, so aiming it slides the iris across the surface like a cartoon
    # eye instead of swivelling a flat disc in place.
    "eye.L": ((0.12, -0.147, 1.34), (0.12, -0.247, 1.34), "head"),
    "lid.L": ((0.12, -0.26, 1.34), (0.12, -0.26, 1.44), "head"),  # upper eyelid; the site blinks it
    "upper_arm.L": ((0.22, 0, 0.98), (0.34, -0.02, 0.8), "spine"),
    "forearm.L": ((0.34, -0.02, 0.8), (0.42, -0.06, 0.62), "upper_arm.L"),
    "upper_arm.R": ((-0.22, 0, 0.98), (-0.34, -0.02, 0.8), "spine"),
    "forearm.R": ((-0.34, -0.02, 0.8), (-0.42, -0.06, 0.62), "upper_arm.R"),
    "thigh.L": ((0.12, 0, 0.6), (0.135, 0, 0.36), "hips"),
    "shin.L": ((0.135, 0, 0.36), (0.15, 0, 0.08), "thigh.L"),
    "thigh.R": ((-0.12, 0, 0.6), (-0.135, 0, 0.36), "hips"),
    "shin.R": ((-0.135, 0, 0.36), (-0.15, 0, 0.08), "thigh.R"),
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
#
# Everything here is placed by how far it stands PROUD of the skull, not by eye.
# The skull surface at the eye's centre (x=0.12, z=1.34) is y = -0.2774, and the
# old build stacked sclera -> iris -> pupil -> catchlight each further FORWARD
# than the last, 0.030 / 0.046 / 0.057 / 0.059 proud of it, with the lid dome at
# 0.057 -- a stepped lens sitting on the face. That is the whole "bug eye" read.
# So the eyeball now sits back, its forward bulge is flattened, and each inner
# part is nested just barely proud of the one in front of it:
#
#   sclera 0.0043   iris 0.0058   pupil 0.0068   catchlight 0.0056   lid 0.0053
#
# The flatter bulges matter as much as the depth. A deep small sphere on a
# shallow big one is exactly the stepped-lens shape this is trying to avoid, and
# a flatter iris keeps its rim from floating off the sclera's curve.
#
# eye.L and lid.L are left where they were. No clip animates them -- the site
# drives them live through ronin.aim() for saccades and blinks -- so the pivot
# geometry, and with it the "the eye slides rather than spins" read, is unchanged.
EYE = Vector((0.12, -0.244, 1.34))
part("head", sphere("eye_white", "eye_white", tuple(EYE), 0.082, (1.0, 0.46, 1.08)))
part("eye.L", sphere("iris", "iris", (0.12, -0.2734, 1.34), 0.061, (1.0, 0.16, 1.0)))
part("eye.L", sphere("pupil", "ink", (0.12, -0.2794, 1.34), 0.034, (0.28, 0.14, 1.3)))
part("eye.L", sphere("catchlight", "eye_white", (0.10, -0.2782, 1.36), 0.012, (1.0, 0.4, 1.0)))
part("eye.L", sphere("catchlight_small", "eye_white", (0.14, -0.2805, 1.318), 0.006, (1.0, 0.4, 1.0)))
LID_R, LID_CUT, LID_TILT, LID_SCALE = 0.09, 0.055, math.radians(10), Vector((1.05, 0.43, 1.1))
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

# Hakama: waist, sash, and one wide fluted trouser leg per leg bone. The knee
# stays on the shin bone so it travels with the shin and covers the joint as it
# bends; the thigh's and shin's pleat phases are offset so they never line up
# into one crease.
part("hips", cone("hakama_waist", "hakama", (0, 0, 0.6), 0.23, 0.2, 0.18, verts=48))
part("hips", torus("sash", "sash", (0, 0, 0.68), 0.21, 0.035))
for side, sx in (("L", 1), ("R", -1)):
    part(f"thigh.{side}", sweep(
        f"hakama_thigh.{side}", "hakama",
        [Vector((0.128 * sx, 0, 0.600)), Vector((0.132 * sx, 0, 0.540)),
         Vector((0.137 * sx, 0, 0.470)), Vector((0.140 * sx, 0, 0.402))],
        # The top ring is nearly the waist's own radius: a narrow one left the
        # hakama reading as a flat plate with two tubes hung off it.
        [0.150, 0.140, 0.136, 0.142],
        verts=56, pleats=6, amp=0.10, phase=0.25 * math.pi))
    # The last three rings are the rolled hem: full, then in, then in again, so
    # the bottom edge is a rounded roll rather than a disc.
    part(f"shin.{side}", sweep(
        f"hakama_shin.{side}", "hakama",
        [Vector((0.141 * sx, 0, 0.400)), Vector((0.144 * sx, 0, 0.330)),
         Vector((0.146 * sx, 0, 0.262)), Vector((0.146 * sx, 0, 0.200)),
         Vector((0.146 * sx, 0, 0.174)), Vector((0.146 * sx, 0, 0.163)),
         Vector((0.146 * sx, 0, 0.157))],
        [0.142, 0.152, 0.161, 0.169, 0.172, 0.167, 0.150],
        verts=56, pleats=6, amp=0.12, phase=0.0, hem_drop=0.010))
    part(f"shin.{side}", sphere(f"hakama_knee.{side}", "hakama", (0.140 * sx, 0, 0.368), 0.145))
    # Paw sunk up inside the hem, with two claw lines drawn onto its surface.
    # Named toe.* so the site's NO_OUTLINE (ronin.js) suppresses the inverted
    # hull that would swallow a 0.0075-radius line whole.
    paw = sphere(f"foot.{side}", "fur", (0.152 * sx, -0.045, 0.112), 0.086, (1.05, 1.45, 0.66))
    part(f"shin.{side}", paw)
    for i, dx in enumerate((-0.032, 0.032)):
        part(f"shin.{side}", stroke(
            f"toe.{side}{i}", "ink", [paw],
            [(0.152 * sx + dx, 0.140), (0.152 * sx + dx * 1.15, 0.108),
             (0.152 * sx + dx * 1.30, 0.082)],
            0.0075, [0.35, 1.0, 0.2]))

# Arms: rolled, frayed flannel sleeves; grey fur forearms and paws
for side, sx in (("L", 1), ("R", -1)):
    ua = BONES[f"upper_arm.{side}"]
    fa = BONES[f"forearm.{side}"]
    part(f"upper_arm.{side}", limb(f"sleeve_upper.{side}", "flannel", ua[0], ua[1], 0.08, 0.08))
    mid = tuple(Vector(fa[0]).lerp(Vector(fa[1]), 0.45))
    part(f"forearm.{side}", limb(f"sleeve_cuff.{side}", "flannel", fa[0], mid, 0.08, 0.095))
    part(f"forearm.{side}", limb(f"forearm_fur.{side}", "fur", mid, fa[1], 0.055, 0.06))
    part(f"forearm.{side}", sphere(f"paw.{side}", "fur", tuple(Vector(fa[1]) + Vector((0, 0, -0.035))), 0.07))

# Tail: one real fur taper -- thin at the root, fullest at 70% of the arc,
# rolled off to a hooked cream tip -- instead of three constant-diameter cones
# with blunt caps. Each spine still runs bone head -> bone tail, so the clips
# drive it unchanged; the joint blobs live on the incoming bone so a bend cannot
# pull the joint open.
TAIL_PEAK = 0.064
TAIL_CURVE = [(0.00, 0.60), (0.18, 0.82), (0.36, 0.96), (0.55, 1.00),
              (0.70, 0.96), (0.82, 0.74), (0.92, 0.48), (1.00, 0.20)]


def tail_radius(u):
    """Radius as a fraction of TAIL_PEAK, at arc fraction u along the whole tail."""
    for (u0, r0), (u1, r1) in zip(TAIL_CURVE, TAIL_CURVE[1:]):
        if u <= u1:
            return TAIL_PEAK * (r0 + (r1 - r0) * ((u - u0) / (u1 - u0)))
    return TAIL_PEAK * TAIL_CURVE[-1][1]


# Static root mass on `hips`: the animated tail.1 head is buried inside the
# hakama waist, so without this the tail reads as growing out of the skirt side.
part("hips", sphere("tail_root", "fur", (0, 0.170, 0.680), 0.076, (1.15, 1.0, 0.9)))
_t_head = [Vector(BONES[f"tail.{i}"][0]) for i in (1, 2, 3)]
_t_tail = [Vector(BONES[f"tail.{i}"][1]) for i in (1, 2, 3)]
_t_len = [(b - a).length for a, b in zip(_t_head, _t_tail)]
_t_total = sum(_t_len)
_run = 0.0
for i, (a, b, L) in enumerate(zip(_t_head, _t_tail, _t_len), start=1):
    path, radii = [], []
    for f in ([0.10, 0.35, 0.62, 0.88, 1.00] if i < 3 else [0.12, 0.34, 0.55, 0.74, 0.90, 1.00]):
        p = a.lerp(b, f)
        if i == 3 and f > 0.70:  # asymmetric tip: curl the last third toward +X
            p = p + Vector((0.030 * (f - 0.70) / 0.30, 0, 0))
        path.append(p)
        radii.append(tail_radius((_run + f * L) / _t_total))
    part(f"tail.{i}", sweep(f"tail.{i}", "fur", path, radii, verts=40))
    _run += L
    if i < 3:
        part(f"tail.{i}", sphere(f"tail_joint.{i}", "fur", tuple(b), tail_radius(_run / _t_total) * 1.06, segs=16))
part("tail.3", sphere("tail_tip", "fur_light", tuple(path[-1]), 0.018))

# Katana, sheathed and tucked in the sash at his left hip: one straight diagonal
# wholly on the +X side, so it never crosses the body centreline, tail buried in
# the waist cone, with a tsuba that has real thickness along the blade.
SAYA_A = Vector((0.185, 0.060, 0.600))
SAYA_B = Vector((0.330, -0.230, 0.830))
SAYA_AXIS = (SAYA_B - SAYA_A).normalized()
part("hips", limb("saya", "ink", tuple(SAYA_A), tuple(SAYA_B), 0.021))
part("hips", limb("tsuka", "wood", tuple(SAYA_B), tuple(SAYA_B + SAYA_AXIS * 0.15), 0.023))
# tsuba: local +Z onto the blade axis, so the oval's 1.6x stretch lies across the
# blade and the 0.9x depth is its thickness along it.
tsuba = torus("tsuba", "gold", tuple(SAYA_B), 0.030, 0.010, scale=(1.6, 1.0, 0.9))
tsuba.rotation_mode = "QUATERNION"
tsuba.rotation_quaternion = SAYA_AXIS.to_track_quat("Z", "Y")
part("hips", tsuba)

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
