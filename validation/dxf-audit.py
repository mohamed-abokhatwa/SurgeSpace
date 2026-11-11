"""Audit SurgeSpace's DXF with ezdxf (an independent reader used by CAD tools): structure, layers and entities.
Run: npx tsx validation/dxf-check.ts /tmp/s.dxf && python3 validation/dxf-audit.py /tmp/s.dxf"""
import sys
import ezdxf
from ezdxf import recover

doc, auditor = recover.readfile(sys.argv[1])
msp = doc.modelspace()
kinds = {}
for e in msp:
    kinds[e.dxftype()] = kinds.get(e.dxftype(), 0) + 1
layers = sorted(l.dxf.name for l in doc.layers)
print("version", doc.dxfversion, "| errors", len(auditor.errors), "| fixes", len(auditor.fixes))
print("entities", kinds)
print("layers", layers)
ok = not auditor.has_errors and kinds.get("LINE", 0) + kinds.get("POLYLINE", 0) + kinds.get("LWPOLYLINE", 0) >= 5 and kinds.get("TEXT", 0) > 0
print("PASS" if ok else "FAIL", "DXF reads cleanly in an independent reader")
sys.exit(0 if ok else 1)
