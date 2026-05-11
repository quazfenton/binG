## curl "https://openrouter.ai/api/v1/models" | python openrouterfree.py
# Or if you saved the JSON first
## curl "https://openrouter.ai/api/v1/models" > models.json
## python openrouterfree.py models.json

import json
import sys

# Read from stdin or file
if len(sys.argv) > 1:
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
else:
    data = json.load(sys.stdin)

models = data.get("data", [])

free = []
for m in models:
    pricing = m.get("pricing", {})
    if all(float(v or 0) == 0 for v in pricing.values()):
        name = m.get("name") or m["id"]
        free.append(f"{m['id']}  ({name})")

if free:
    print("Free models found:")
    print("\n".join(free))
else:
    print("No completely free models found right now.")