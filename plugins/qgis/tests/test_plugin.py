"""Headless test of the SurgeSpace QGIS plug-in against a real QGIS (qgis.core), with a stand-in for the QGIS
window: export two layers, import them with SurgeSpace's own importer, then load SurgeSpace results back.
Run: QT_QPA_PLATFORM=offscreen python3 plugins/qgis/tests/test_plugin.py"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))

from qgis.core import QgsApplication, QgsCoordinateReferenceSystem, QgsFeature, QgsGeometry, QgsPointXY, QgsProject, QgsVectorLayer, QgsGraduatedSymbolRenderer
from qgis.PyQt import QtWidgets

app = QgsApplication([], False)
app.initQgis()
passed = failed = 0
def t(name, ok, info=""):
    global passed, failed
    print(("PASS " if ok else "FAIL ") + name + (f" ({info})" if info else ""))
    if ok: passed += 1
    else: failed += 1

import surgespace.plugin as plug

tmp = tempfile.mkdtemp()
messages = []
plug.QMessageBox.information = staticmethod(lambda *a: messages.append(("info", a[2])))
plug.QMessageBox.warning = staticmethod(lambda *a: messages.append(("warn", a[2])))

class Bar:
    def pushInfo(self, *a): messages.append(("bar", a[1]))
class Tree:
    def __init__(self, layers): self.layers = layers
    def selectedLayers(self): return self.layers
class Iface:
    def __init__(self, layers): self.tree = Tree(layers); self.menus = []
    def mainWindow(self): return None
    def layerTreeView(self): return self.tree
    def addPluginToMenu(self, m, a): self.menus.append(a.text())
    def removePluginMenu(self, m, a): self.menus.remove(a.text())
    def messageBar(self): return Bar()

# a small network in UTM 37N: three nodes and two pipes with SurgeSpace-style fields
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem("EPSG:32637"))
nodes = QgsVectorLayer("Point?crs=EPSG:32637&field=id:string&field=elevation:double", "nodes", "memory")
pipes = QgsVectorLayer("LineString?crs=EPSG:32637&field=id:string&field=diameter:double&field=material:string", "pipes", "memory")
pts = [("A", 500000, 2400000, 100.0), ("B", 500800, 2400600, 112.0), ("C", 501800, 2400600, 95.0)]
for nid, x, y, z in pts:
    f = QgsFeature(nodes.fields()); f.setAttributes([nid, z]); f.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y))); nodes.dataProvider().addFeature(f)
for pid, a, b, d in (("P1", 0, 1, 600.0), ("P2", 1, 2, 500.0)):
    f = QgsFeature(pipes.fields()); f.setAttributes([pid, d, "Ductile iron"])
    f.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(pts[a][1], pts[a][2]), QgsPointXY(pts[b][1], pts[b][2])])); pipes.dataProvider().addFeature(f)
QgsProject.instance().addMapLayers([nodes, pipes])

iface = Iface([nodes, pipes])
p = plug.SurgeSpacePlugin(iface)
p.initGui()
t("menu entries", len(iface.menus) == 2, ", ".join(iface.menus))

out = os.path.join(tmp, "net.geojson")
plug.QFileDialog.getSaveFileName = staticmethod(lambda *a: (out, ""))
p.export()
g = json.load(open(out))
t("export writes points and lines with the projected CRS", len(g["features"]) == 5 and "32637" in g["crs"]["properties"]["name"], messages[-1][1])
r = subprocess.run(["npx", "tsx", os.path.join(HERE, "gis-helper.ts"), "import", out], cwd=ROOT, capture_output=True, text=True)
imp = json.loads(r.stdout.strip().splitlines()[-1])
t("SurgeSpace imports the export: nodes, pipes, lengths, diameters, elevations", imp["nodes"] == 3 and imp["pipes"] == 2 and imp["lengths"] == [1000, 1000] and abs(imp["diam"][0] - 0.6) < 1e-9 and sorted(imp["elev"]) == [95, 100, 112], json.dumps(imp))

# a geographic project is refused with a plain message
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
p.export()
t("geographic CRS is refused", messages[-1][0] == "warn" and "metres" in messages[-1][1])
QgsProject.instance().setCrs(QgsCoordinateReferenceSystem("EPSG:32637"))

# results back: graduated layers
res = os.path.join(tmp, "results.geojson")
subprocess.run(["npx", "tsx", os.path.join(HERE, "gis-helper.ts"), "results", res], cwd=ROOT, check=True)
plug.QFileDialog.getOpenFileName = staticmethod(lambda *a: (res, ""))
before = len(QgsProject.instance().mapLayers())
p.load()
added = [l for l in QgsProject.instance().mapLayers().values() if l.name().startswith("results")]
ok = len(added) == 2 and all(isinstance(l.renderer(), QgsGraduatedSymbolRenderer) for l in added)
t("results load as two graduated layers (pipes by max pressure, nodes by min pressure)", ok, ", ".join(f"{l.name()}: {l.featureCount()} features, {type(l.renderer()).__name__}" for l in added))
p.unload()
t("unload removes the menu", not iface.menus)
print(f"\n{passed} passed, {failed} failed")
app.exitQgis()
sys.exit(1 if failed else 0)
