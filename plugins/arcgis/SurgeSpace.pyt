# -*- coding: utf-8 -*-
"""SurgeSpace toolbox for ArcGIS Pro (add it in the Catalog pane: Toolboxes → Add Toolbox).

Send to SurgeSpace: node (point) and pipe (line) feature classes → one GeoJSON file in the map's projected
coordinate system, opened in SurgeSpace with File → Import GIS layer.
Load SurgeSpace results: a SurgeSpace GeoJSON export → point and line feature classes with the result fields
(max_pressure_m, min_pressure_m, over_class, vapour_cavity_l …) for symbology and reports.
"""
import json
import os
import tempfile

import arcpy


class Toolbox(object):
    def __init__(self):
        self.label = "SurgeSpace"
        self.alias = "surgespace"
        self.tools = [SendToSurgeSpace, LoadResults]


class SendToSurgeSpace(object):
    def __init__(self):
        self.label = "Send network to SurgeSpace"
        self.description = "Write nodes and pipes to a GeoJSON file for SurgeSpace."

    def getParameterInfo(self):
        nodes = arcpy.Parameter(displayName="Nodes (points)", name="nodes", datatype="GPFeatureLayer", parameterType="Optional", direction="Input")
        nodes.filter.list = ["Point"]
        pipes = arcpy.Parameter(displayName="Pipes (lines)", name="pipes", datatype="GPFeatureLayer", parameterType="Required", direction="Input")
        pipes.filter.list = ["Polyline"]
        out = arcpy.Parameter(displayName="Output GeoJSON", name="out", datatype="DEFile", parameterType="Required", direction="Output")
        out.filter.list = ["geojson"]
        return [nodes, pipes, out]

    def execute(self, parameters, messages):
        nodes, pipes, out = (p.valueAsText for p in parameters)
        sr = arcpy.Describe(pipes).spatialReference
        if sr.type == "Geographic":
            raise arcpy.ExecuteError("Project the data to a coordinate system in metres first (for example UTM).")
        features = []
        tmp = tempfile.mkdtemp()
        for layer, tag in ((nodes, "nodes"), (pipes, "pipes")):
            if not layer:
                continue
            path = os.path.join(tmp, f"{tag}.geojson")
            arcpy.conversion.FeaturesToJSON(layer, path, geoJSON="GEOJSON", outputToWGS84="KEEP_INPUT_SR", include_z_values="Z_VALUES")
            with open(path, encoding="utf-8") as fh:
                for f in json.load(fh).get("features", []):
                    f.setdefault("properties", {})["layer"] = tag
                    features.append(f)
        doc = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{sr.factoryCode}"}}, "features": features}
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
        messages.addMessage(f"{len(features)} features written to {out}. In SurgeSpace: File → Import GIS layer (GeoJSON).")


class LoadResults(object):
    def __init__(self):
        self.label = "Load SurgeSpace results"
        self.description = "Create point and line feature classes from a SurgeSpace GeoJSON export."

    def getParameterInfo(self):
        src = arcpy.Parameter(displayName="SurgeSpace GeoJSON", name="src", datatype="DEFile", parameterType="Required", direction="Input")
        src.filter.list = ["geojson", "json"]
        gdb = arcpy.Parameter(displayName="Output geodatabase", name="gdb", datatype="DEWorkspace", parameterType="Required", direction="Input")
        name = arcpy.Parameter(displayName="Name", name="name", datatype="GPString", parameterType="Required", direction="Input")
        name.value = "surge"
        return [src, gdb, name]

    def execute(self, parameters, messages):
        src, gdb, name = (p.valueAsText for p in parameters)
        for geom, suffix in (("POINT", "nodes"), ("POLYLINE", "pipes")):
            out = os.path.join(gdb, f"{name}_{suffix}")
            arcpy.conversion.JSONToFeatures(src, out, geometry_type=geom)
            messages.addMessage(f"Created {out}")
        messages.addMessage("Symbolise the pipes by max_pressure_m (graduated colours) and highlight over_class = 1.")
