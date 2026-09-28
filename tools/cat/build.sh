#!/usr/bin/env bash
# Build Cat Ronin: model + rig + every clip in clips.json -> public/cat/ronin.glb
# BLENDER overrides the Blender binary (default: the macOS app bundle).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
blender="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
out="$root/public/cat/ronin.glb"
mkdir -p "$(dirname "$out")"
"$blender" -b --factory-startup -P "$here/build_cat.py" -- "$here/clips.json" "$out" 2>&1 | grep -E '^(clip|exported)|Error|Traceback|^  File' || true
python3 "$here/check_glb.py" "$out" "$here/clips.json"
# Clip manifest the site reads (glTF has no loop flag): [{name, loop, frames}]
python3 -c "import json,sys; c=json.load(open(sys.argv[1])); json.dump([{'name':x['name'],'loop':x.get('loop',False),'frames':x['frames']} for x in c], open(sys.argv[2],'w'))" "$here/clips.json" "$root/public/cat/ronin.clips.json"
echo "wrote public/cat/ronin.clips.json"
