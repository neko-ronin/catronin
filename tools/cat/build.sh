#!/usr/bin/env bash
# Build Cat Ronin: Tumbler's model + every clip in clips.json -> public/cat/ronin.glb
# build_cat.py bakes the clips on the site's authoring rig; import_tumbler.py moves
# them onto Tumbler's model. BLENDER overrides the Blender binary (default: the
# macOS app bundle); TUMBLER_GLB overrides the model. pack.mjs compresses the result
# and refuses it if it no longer matches.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
blender="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
model="${TUMBLER_GLB:-$root/../tumbler/shared/geometry/cat-ronin/ronin.glb}"
out="$root/public/cat/ronin.glb"
mkdir -p "$(dirname "$out")"
work="$(mktemp -d)"
clips="$work/clips.glb"
"$blender" -b --factory-startup -P "$here/build_cat.py" -- "$here/clips.json" "$clips" 2>&1 | grep -E '^(clip|exported)|Error|Traceback|^  File' || true
python3 "$here/import_tumbler.py" "$model" "$clips" "$work/ronin.glb"
python3 "$here/check_glb.py" "$work/ronin.glb" "$here/clips.json"
node "$here/pack.mjs" "$work/ronin.glb" "$out"
python3 "$here/check_glb.py" "$out" "$here/clips.json"
# Clip manifest the site reads (glTF has no loop flag): [{name, loop, frames}]
python3 -c "import json,sys; c=json.load(open(sys.argv[1])); json.dump([{'name':x['name'],'loop':x.get('loop',False),'frames':x['frames']} for x in c], open(sys.argv[2],'w'))" "$here/clips.json" "$root/public/cat/ronin.clips.json"
echo "wrote public/cat/ronin.clips.json"
