"""Cat Ronin's katana: the meshes, where he wears it, and the clip that draws it.
Used by import_tumbler.py. Stdlib only.

Sword space: the origin is the guard, +Y runs up the grip, -Y runs down the blade,
+X is the cutting edge and Z is the flat. Worn, the edge faces up, as a katana is.

He holds nothing permanently, so there are two hilts: one on the hips and one on
his left forearm. The clip swaps them by scale on the frame his paw closes on the
grip, and that only reads if the paw is really there, so author_draw() asserts it.
"""
import math

from import_tumbler import inv, mul, power

BLADE = 0.38  # guard to tip; his arm reaches 0.39, longer never clears the scabbard
SORI = 0.125  # the curve: x = -SORI * s^2 down the blade
# The scabbard's line through the sash at his left hip, in hips space, from the
# first model (SAYA_A and SAYA_B in build_cat.py).
TAIL_END = (0.185, 0.05, -0.06)
MOUTH = (0.33, 0.28, 0.23)
HIPS_Y = 0.55
GRIP = 0.08  # where the paw closes, up the grip from the guard
FPS = 24


def linear(hex_colour):
    """glTF vertex colours are linear; these are written as sRGB."""
    channels = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)


GOLD = linear("#c89a3c")
IRON = linear("#3b3a42")
SILVER = linear("#b9bdc2")
ITO = linear("#1b2030")
SAME = linear("#e8dfc8")
LACQUER = linear("#5a161b")
CORD = linear("#c9962e")
HAMON = linear("#f6f7f3")
STEEL = linear("#7c8791")
RIDGE = linear("#aab3ba")


# ── Vectors and rotations ──
def add(a, b, k=1):
    return tuple(x + y * k for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a):
    size = math.sqrt(dot(a, a))
    return tuple(x / size for x in a)


def rotate(q, v):
    u, w = q[:3], q[3]
    c = cross(u, v)
    return add(add(v, c, 2 * w), cross(u, c), 2)


def about(axis, degrees):
    half = math.radians(degrees) / 2
    return (*(x * math.sin(half) for x in unit(axis)), math.cos(half))


def euler(pitch=0, yaw=0, roll=0):
    """Character axes, as aim-layer.js has them: +pitch looks down, +yaw turns to his left."""
    return mul(about((0, 1, 0), yaw), mul(about((0, 0, 1), -roll), about((1, 0, 0), pitch)))


def arc(a, b):
    """The shortest rotation taking direction a to direction b."""
    a, b = unit(a), unit(b)
    c = cross(a, b)
    d = dot(a, b)
    if d < -0.9999:
        return about((1, 0, 0) if abs(a[0]) < 0.9 else (0, 1, 0), 180)
    w = 1 + d
    size = math.sqrt(dot(c, c) + w * w)
    return (c[0] / size, c[1] / size, c[2] / size, w / size)


def basis(x_hint, y):
    """Rotation whose +Y is y and whose +X is as near x_hint as a right angle allows."""
    y = unit(y)
    x = unit(sub(x_hint, tuple(v * dot(x_hint, y) for v in y)))
    z = cross(x, y)
    m = (x, y, z)  # columns
    trace = x[0] + y[1] + z[2]
    if trace > 0:
        s = 2 * math.sqrt(1 + trace)
        return ((y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4)
    i = max(range(3), key=lambda k: m[k][k])
    j, k = (i + 1) % 3, (i + 2) % 3
    s = 2 * math.sqrt(1 + m[i][i] - m[j][j] - m[k][k])
    q = [0, 0, 0, (m[j][k] - m[k][j]) / s]
    q[i], q[j], q[k] = s / 4, (m[i][j] + m[j][i]) / s, (m[i][k] + m[k][i]) / s
    return tuple(q)


def slerp(a, b, t):
    return mul(power(mul(b, inv(a)), t), a)


# ── Meshes ──
class Mesh:
    def __init__(self):
        self.positions, self.normals, self.colours, self.indices = [], [], [], []

    def stack(self, rings, sides, closed=True):
        """Joins rings of `sides` (position, normal, colour) vertices into a strip."""
        start = len(self.positions)
        for ring in rings:
            for position, normal, colour in ring:
                self.positions.append(position)
                self.normals.append(unit(normal))
                self.colours.append(colour)
        count = sides if closed else sides - 1
        for r in range(len(rings) - 1):
            for s in range(count):
                a = start + r * sides + s
                b = start + r * sides + (s + 1) % sides
                c, d = a + sides, b + sides
                for t in ((a, c, b), (b, c, d)):
                    # Rings run either way down the sword, so wind from the normals.
                    p0, p1, p2 = (self.positions[i] for i in t)
                    if dot(cross(sub(p1, p0), sub(p2, p0)), self.normals[t[0]]) < 0:
                        t = (t[0], t[2], t[1])
                    self.indices += t


def centre(s):
    return -SORI * s * s


def ellipse(y, x, rx, rz, slope, colour, sides=20):
    """One ring. slope tips the normal along Y: 0 faces out, +-1 faces along the sword."""
    ring = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        radial = (math.cos(a) / rx, 0, math.sin(a) / rz)
        radial = unit(radial)
        keep = 1 - abs(slope)
        ring.append(((x + rx * math.cos(a), y, rz * math.sin(a)), (radial[0] * keep, slope, radial[2] * keep), colour(a) if callable(colour) else colour))
    return ring


def blade_mesh():
    mesh = Mesh()
    # Habaki: the gold collar that seats the blade in the scabbard.
    mesh.stack([ellipse(-y, centre(y), 0.029 - y * 0.12, 0.0105, slope, GOLD, 12) for y, slope in ((0.0, 1), (0.001, 0), (0.024, 0), (0.025, -1))], 12)
    # One bevel on each flat, the ridge line, and a narrow back. The strips between
    # edge and ridge exist to carry the hamon, the wavy temper line along the edge.
    steps = 54
    fractions = (0, 0.2, 0.4, 0.6, 0.8, 1)
    for side in (1, -1):
        rings = []
        for i in range(steps + 1):
            s = 0.02 + (BLADE - 0.02) * i / steps
            tip = max(0.0, (s - (BLADE - 0.05)) / 0.05)
            half = (0.027 - 0.01 * s) * math.sqrt(max(0.0, 1 - tip * tip))
            ridge_x, ridge_z = -0.2 * half, 0.0052 * side * (1 - tip)
            wave = 0.55 + 0.13 * math.sin(s * 95) + 0.05 * math.sin(s * 233)
            ring = []
            for f in fractions:
                x = half + (ridge_x - half) * f
                z = ridge_z * f
                ring.append(((centre(s) + x, -s, z), (0.25, 0, side), HAMON if f < wave else STEEL))
            for f in (0, 1):  # ridge to back, on its own normal so the ridge stays crisp
                x = ridge_x + (-half - ridge_x) * f
                ring.append(((centre(s) + x, -s, ridge_z * (1 - 0.35 * f)), (-0.2, 0, side), RIDGE))
            rings.append(ring)
        mesh.stack(rings, len(fractions) + 2, closed=False)
    return mesh


def hilt_mesh():
    mesh = Mesh()
    # Tsuba: an iron oval with a gold rim, thick enough to read from the side.
    rim = lambda _: GOLD
    mesh.stack([
        ellipse(0.005, 0, 0.012, 0.01, 1, IRON), ellipse(0.005, 0, 0.042, 0.032, 1, IRON),
        ellipse(0.005, 0, 0.044, 0.034, 1, rim), ellipse(0.0055, 0, 0.05, 0.039, 1, rim),
        ellipse(0.0055, 0, 0.05, 0.039, 0, rim), ellipse(-0.0055, 0, 0.05, 0.039, 0, rim),
        ellipse(-0.0055, 0, 0.05, 0.039, -1, rim), ellipse(-0.0055, 0, 0.012, 0.01, -1, IRON),
    ], 20)
    # Seppa and fuchi: the silver washer, then the gold-edged collar at the grip's foot.
    mesh.stack([ellipse(y, 0, rx, rz, slope, colour) for y, rx, rz, slope, colour in (
        (0.0055, 0.0225, 0.0175, 0, SILVER), (0.008, 0.0225, 0.0175, 0, SILVER),
        (0.008, 0.0215, 0.0165, 0, GOLD), (0.012, 0.0215, 0.0165, 0, GOLD),
        (0.012, 0.0212, 0.0162, 0, IRON), (0.024, 0.0208, 0.016, 0, IRON),
    )], 20)
    # The grip: ito cord wound in crossing bands over pale ray skin, the cord proud
    # of the skin so the diamonds have real relief, with a gold menuki under the cord.
    sides, rings = 28, []
    for i in range(49):
        f = i / 48
        y = 0.024 + 0.128 * f
        pinch = 1 - 0.07 * math.sin(math.pi * f)
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            u, v = f * 6, j / sides * 2
            band = lambda w: abs((w % 1) - 0.5) * 2
            diamond = min(band(u + v), band(u - v))
            cord = diamond < 0.5
            lift = 0.0014 if cord else 0
            rx, rz = 0.0205 * pinch + lift, 0.0155 * pinch + lift
            colour = ITO if cord else SAME
            if abs(f - 0.5) < 0.09 and abs(abs(math.sin(a)) - 1) < 0.03:
                colour = GOLD
            radial = unit((math.cos(a) / rx, 0, math.sin(a) / rz))
            ring.append(((rx * math.cos(a), y, rz * math.sin(a)), radial, colour))
        rings.append(ring)
    mesh.stack(rings, sides)
    # Kashira: the pommel cap.
    mesh.stack([ellipse(y, 0, rx, rz, slope, colour) for y, rx, rz, slope, colour in (
        (0.152, 0.0214, 0.0166, 0, GOLD), (0.156, 0.0214, 0.0166, 0, GOLD), (0.156, 0.0208, 0.016, 0, IRON),
        (0.164, 0.0196, 0.015, 0.3, IRON), (0.168, 0.012, 0.009, 1, IRON), (0.168, 0.001, 0.001, 1, IRON),
    )], 20)
    return mesh


def scabbard_mesh():
    mesh = Mesh()
    # Lacquer from a gold mouth to a gold chape, the mustard sageo cord lashed near
    # the mouth where it would tie into the sash.
    rings = [ellipse(0, 0, 0.014, 0.007, 1, IRON), ellipse(0, 0, 0.033, 0.0172, 1, GOLD)]
    steps = 44
    length = BLADE + 0.02
    for i in range(steps + 1):
        s = length * i / steps
        rx, rz, colour = 0.033, 0.0172, LACQUER
        if s < 0.016:
            colour = GOLD
        elif 0.05 < s < 0.09:
            ridge = abs(math.sin((s - 0.05) / 0.04 * math.pi * 4))
            rx, rz, colour = rx + 0.0018 * ridge, rz + 0.0018 * ridge, CORD
        elif s > length - 0.034:
            colour = GOLD
        taper = 1 - 0.14 * (s / length)
        rings.append(ellipse(-s, centre(s), rx * taper, rz * taper, 0, colour))
    tail = centre(length)
    rings.append(ellipse(-length - 0.008, tail, 0.033 * 0.7, 0.0172 * 0.7, -0.6, GOLD))
    rings.append(ellipse(-length - 0.012, tail, 0.001, 0.001, -1, GOLD))
    mesh.stack(rings, 20)
    return mesh


def worn():
    """(translation, rotation) of the guard on the hips."""
    axis = unit(sub(MOUTH, TAIL_END))
    return MOUTH, basis((0, 1, 0), axis)


# ── The clip ──
def key(t, hand, tip=None, edge=(0, 0, 1), spine=(0, 0, 0), head=(0, 0, 0), pull=0):
    return {"t": t, "hand": hand, "tip": tip, "edge": edge, "spine": euler(*spine), "head": euler(*head), "pull": pull}


def author_draw(rig, sit):
    """The seated draw: `sit` plus a left arm, a turning torso and a sword.
    rig is Tumbler's, sit its retargeted sit tracks. -> tracks for the writer."""
    mouth, sheath_rotation = worn()
    axis = rotate(sheath_rotation, (0, 1, 0))
    edge_up = rotate(sheath_rotation, (1, 0, 0))
    guard = add(mouth, (0, HIPS_Y, 0))
    gripped = add(guard, axis, GRIP)
    drawn = add(gripped, axis, 0.16)

    def sample(bone, t, default):
        track = sit.get((bone, "rotation"))
        if not track:
            return default
        times, values = track
        t = t % times[-1][0]
        i = min(int(t / times[-1][0] * (len(values) - 1)), len(values) - 2)
        f = t / times[-1][0] * (len(values) - 1) - i
        return slerp(values[i], values[i + 1], f)

    def spine_world(t, spine_turn):
        hips = sample("hips", t, rig.rest("hips"))
        q = mul(hips, mul(spine_turn, sample("spine", t, rig.rest("spine"))))
        return q, add((0, HIPS_Y, 0), rotate(hips, rig.offset("spine")))

    # The shoulder's place on the spine, and how long the arm's two bones are.
    shoulder_at = rig.offset("upper_arm.L")
    elbow_along = rig.offset("forearm.L")
    paw_along = (0, 0.2, 0)
    upper_len, fore_len = math.dist(elbow_along, (0, 0, 0)), math.dist(paw_along, (0, 0, 0))

    def arm(t, spine_turn, target):
        spine_q, spine_at = spine_world(t, spine_turn)
        shoulder = add(spine_at, rotate(spine_q, shoulder_at))
        to = sub(target, shoulder)
        reach = min(math.dist(target, shoulder), upper_len + fore_len - 0.001)
        direction = unit(to)
        along = (reach * reach + upper_len * upper_len - fore_len * fore_len) / (2 * reach)
        out = math.sqrt(max(0.0, upper_len * upper_len - along * along))
        pole = unit((0.9, -0.5, -0.35))
        bend = unit(sub(pole, tuple(v * dot(pole, direction) for v in direction)))
        elbow = add(add(shoulder, direction, along), bend, out)
        upper_rest = mul(spine_q, sample("upper_arm.L", t, rig.rest("upper_arm.L")))
        upper = mul(arc(rotate(upper_rest, (0, 1, 0)), sub(elbow, shoulder)), upper_rest)
        fore_rest = mul(upper, sample("forearm.L", t, rig.rest("forearm.L")))
        hand_now = add(elbow, unit(sub(add(shoulder, direction, reach), elbow)), fore_len)
        fore = mul(arc(rotate(fore_rest, (0, 1, 0)), sub(hand_now, elbow)), fore_rest)
        return mul(inv(spine_q), upper), mul(inv(upper), fore), elbow, fore, hand_now

    # Where sit leaves his paw, so the clip leaves and returns without a jump.
    elbow_rest, fore_rest = pose_of(rig, sit, "forearm.L")
    rest_hand = add(elbow_rest, rotate(fore_rest, paw_along))

    twist = (10, -30, 0)
    keys = [
        key(0.00, rest_hand),
        key(0.50, gripped, spine=twist, head=(22, 38, 6)),
        key(0.58, gripped, spine=twist, head=(22, 38, 6)),
        key(0.86, drawn, spine=(8, -36, 0), head=(14, 34, 4), pull=0.08),
        key(1.04, add(drawn, (-0.05, 0.05, 0)), tip=(0.55, 0.62, 0.56), edge=(-0.4, 0.8, 0), spine=(4, -28, 0), head=(4, 26, 0), pull=0.04),
        # He holds it up beside his open eye, flat to the light, and turns it.
        key(1.45, (0.3, 1.05, 0.3), tip=(0.2, 1, 0.22), edge=(1, 0, -0.1), spine=(0, -14, 0), head=(-12, 18, -6)),
        key(2.05, (0.3, 1.07, 0.3), tip=(0.22, 1, 0.2), edge=(0.85, 0, 0.5), spine=(0, -12, 0), head=(-16, 16, -10)),
        key(2.55, (0.3, 1.06, 0.3), tip=(0.18, 1, 0.26), edge=(1, 0, -0.5), spine=(0, -12, 0), head=(-14, 14, 8)),
        # A cut across the front, flat side out so it reads at the size he is on the page.
        key(2.92, (0.36, 1.03, 0.13), tip=(0.8, 0.42, 0.42), edge=(-0.4, 0.9, 0), spine=(2, -34, -4), head=(4, -8, 0)),
        key(3.14, (0.03, 0.93, 0.25), tip=(-0.72, -0.02, 0.69), edge=(0, 1, 0), spine=(10, 24, 4), head=(8, -14, 0)),
        key(3.42, (0.02, 0.95, 0.25), tip=(-0.68, 0.05, 0.72), edge=(0, 1, 0.05), spine=(9, 22, 3), head=(6, -12, 0)),
        # Chiburi: the flick that clears the blade, then home.
        key(3.74, (0.31, 0.89, 0.24), tip=(0.62, -0.52, 0.58), edge=(0.5, 0.6, -0.4), spine=(6, -20, 0), head=(14, 18, 0)),
        key(4.32, drawn, spine=(8, -36, 0), head=(16, 34, 4), pull=0.08),
        key(4.72, gripped, spine=twist, head=(22, 38, 6)),
        key(4.78, gripped, spine=twist, head=(22, 38, 6)),
        key(5.30, rest_hand),
    ]
    for k in keys:
        if k["tip"] is None:
            k["rotation"] = basis(edge_up, axis)
        else:
            k["rotation"] = basis(k["edge"], tuple(-v for v in k["tip"]))

    def ease(a, b, t):
        f = max(0.0, min(1.0, (t - a) / (b - a)))
        return f * f * (3 - 2 * f)

    def at(t):
        for a, b in zip(keys, keys[1:]):
            if t <= b["t"]:
                f = ease(a["t"], b["t"], t)
                return (
                    add(a["hand"], sub(b["hand"], a["hand"]), f),
                    slerp(a["rotation"], b["rotation"], f),
                    slerp(a["spine"], b["spine"], f),
                    slerp(a["head"], b["head"], f),
                    a["pull"] + (b["pull"] - a["pull"]) * f,
                )
        raise AssertionError(t)

    frames = round(keys[-1]["t"] * FPS)
    tracks = {}
    columns = {"spine": [], "head": [], "upper_arm.L": [], "forearm.L": [], "saya": [], "drawn_at": [], "drawn_turn": []}
    times = [(i / FPS,) for i in range(frames + 1)]
    worst = 0
    for i in range(frames + 1):
        t = i / FPS
        hand, rotation, spine_turn, head_turn, pull = at(t)
        upper, fore, elbow, fore_world, reached = arm(t, spine_turn, hand)
        worst_here = math.dist(reached, hand)
        if keys[1]["t"] <= t <= keys[3]["t"] or keys[-4]["t"] <= t <= keys[-2]["t"]:
            worst = max(worst, worst_here)  # on the hilt, drawing or sheathing
        columns["spine"].append(mul(spine_turn, sample("spine", t, rig.rest("spine"))))
        columns["head"].append(mul(head_turn, sample("head", t, rig.rest("head"))))
        columns["upper_arm.L"].append(upper)
        columns["forearm.L"].append(fore)
        columns["saya"].append(add(mouth, axis, -pull))
        guard_now = sub(reached, rotate(rotation, (0, GRIP, 0)))
        columns["drawn_at"].append(rotate(inv(fore_world), sub(guard_now, elbow)))
        columns["drawn_turn"].append(mul(inv(fore_world), rotation))
    assert worst < 0.012, f"his paw misses the hilt by {worst * 1000:.0f} mm; move the keys or the sword"

    for bone in ("spine", "head", "upper_arm.L", "forearm.L"):
        tracks[bone, "rotation"] = (times, columns[bone])
    tracks["saya", "translation"] = (times, columns["saya"])
    tracks["sword.drawn", "translation"] = (times, columns["drawn_at"])
    tracks["sword.drawn", "rotation"] = (times, columns["drawn_turn"])
    hidden, shown = (0.001,) * 3, (1.0,) * 3
    grab, sheathe = keys[2]["t"], keys[-2]["t"]
    steps = [(0.0,), (grab,), (grab + 0.001,), (sheathe,), (sheathe + 0.001,), (keys[-1]["t"],)]
    tracks["sword.drawn", "scale"] = (steps, [hidden, hidden, shown, shown, hidden, hidden])
    tracks["sword.sheathed", "scale"] = (steps, [shown, shown, hidden, hidden, shown, shown])

    # The rest of him keeps sitting, tail and breath included.
    for (bone, path), (track_times, values) in sit.items():
        if (bone, path) in tracks or path != "rotation":
            continue
        count = frames + 1
        tracks[bone, path] = (times, [sample(bone, i / FPS, None) for i in range(count)]) if len(values) > 2 else (track_times, values)
    return tracks, worst


def pose_of(rig, sit, bone):
    """(position, rotation) of a bone in the model on sit's first frame."""
    position, q = (0, 0, 0), (0, 0, 0, 1)
    for link in rig.chain(bone):
        position = add(position, rotate(q, rig.offset(link)))
        track = sit.get((link, "rotation"))
        q = mul(q, track[1][0] if track else rig.rest(link))
    return position, q
