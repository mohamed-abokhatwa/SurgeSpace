"""SurgeSpace for QGIS: send networks to SurgeSpace, load surge results back.

Export: every selected vector layer (points = nodes, lines = pipes) is written into one GeoJSON file in the
project's coordinate system (metres). Field names such as id, elevation, diameter, material, roughness and
wave speed are matched by SurgeSpace when it imports the file.
Results: a SurgeSpace GeoJSON export (File -> Export GIS) is loaded as two layers, pipes graduated by maximum
pressure (pipes over their class drawn red) and nodes by minimum pressure.
"""
import json
import os

from qgis.PyQt.QtWidgets import QAction, QFileDialog, QMessageBox
from qgis.core import (
    QgsCoordinateTransform, QgsGraduatedSymbolRenderer, QgsJsonExporter, QgsProject, QgsRendererRange,
    QgsSymbol, QgsVectorLayer, QgsWkbTypes,
)
from qgis.PyQt.QtGui import QColor


class SurgeSpacePlugin:
    def __init__(self, iface):
        self.iface = iface
        self.actions = []

    def initGui(self):
        for text, slot in (("Send selected layers to SurgeSpace…", self.export), ("Load SurgeSpace results…", self.load)):
            a = QAction(text, self.iface.mainWindow())
            a.triggered.connect(slot)
            self.iface.addPluginToMenu("SurgeSpace", a)
            self.actions.append(a)

    def unload(self):
        for a in self.actions:
            self.iface.removePluginMenu("SurgeSpace", a)

    # -- export ------------------------------------------------------------------------------------------
    def export(self):
        layers = [l for l in self.iface.layerTreeView().selectedLayers() if isinstance(l, QgsVectorLayer)]
        if not layers:
            QMessageBox.information(None, "SurgeSpace", "Select the node (point) and pipe (line) layers in the Layers panel first.")
            return
        crs = QgsProject.instance().crs()
        if crs.isGeographic():
            QMessageBox.warning(None, "SurgeSpace", "The project uses degrees. Set a projected coordinate system in metres (for example UTM) so pipe lengths are right.")
            return
        path, _ = QFileDialog.getSaveFileName(None, "Save for SurgeSpace", "", "GeoJSON (*.geojson)")
        if not path:
            return
        features = []
        for layer in layers:
            gt = QgsWkbTypes.geometryType(layer.wkbType())
            if gt not in (QgsWkbTypes.PointGeometry, QgsWkbTypes.LineGeometry):
                continue
            exporter = QgsJsonExporter(layer)
            exporter.setDestinationCrs(crs)
            exporter.setTransformGeometries(True)
            sel = layer.selectedFeatures() or list(layer.getFeatures())
            data = json.loads(exporter.exportFeatures(sel))
            for f in data.get("features", []):
                f.setdefault("properties", {})["layer"] = "nodes" if gt == QgsWkbTypes.PointGeometry else "pipes"
                features.append(f)
        epsg = crs.postgisSrid()
        out = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}}, "features": features}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(out, fh)
        QMessageBox.information(None, "SurgeSpace", f"{len(features)} features written. In SurgeSpace: File → Import GIS layer (GeoJSON).")

    # -- results -----------------------------------------------------------------------------------------
    def load(self):
        path, _ = QFileDialog.getOpenFileName(None, "SurgeSpace results", "", "GeoJSON (*.geojson *.json)")
        if not path:
            return
        name = os.path.splitext(os.path.basename(path))[0]
        pipes = QgsVectorLayer(f"{path}|geometrytype=LineString", f"{name} · pipes", "ogr")
        nodes = QgsVectorLayer(f"{path}|geometrytype=Point", f"{name} · nodes", "ogr")
        for layer, field, colours in ((pipes, "max_pressure_m", ("#2c7bb6", "#ffffbf", "#d7191c")), (nodes, "min_pressure_m", ("#d7191c", "#ffffbf", "#2c7bb6"))):
            if not layer.isValid():
                continue
            idx = layer.fields().indexFromName(field)
            if idx >= 0:
                vals = [f[field] for f in layer.getFeatures() if f[field] is not None]
                if vals:
                    lo, hi = min(vals), max(vals)
                    step = (hi - lo) / 3 or 1
                    ranges = []
                    for i, c in enumerate(colours):
                        sym = QgsSymbol.defaultSymbol(layer.geometryType())
                        sym.setColor(QColor(c))
                        if layer.geometryType() == QgsWkbTypes.LineGeometry:
                            sym.setWidth(0.9)
                        a, b = lo + i * step, lo + (i + 1) * step
                        ranges.append(QgsRendererRange(a, b, sym, f"{a:.1f} – {b:.1f} m"))
                    layer.setRenderer(QgsGraduatedSymbolRenderer(field, ranges))
            QgsProject.instance().addMapLayer(layer)
        self.iface.messageBar().pushInfo("SurgeSpace", "Results loaded: pipes by maximum pressure, nodes by minimum pressure.")
