# SurgeSpace plug-ins for GIS and CAD

SurgeSpace exchanges networks and results as **GeoJSON** (every GIS) and **DXF** (every CAD program): File →
Import GIS layer, File → Export GIS (GeoJSON, with results), File → Export CAD (DXF, with results). The plug-ins
add one-click buttons inside the other programs.

| Program | Plug-in | Install | Status |
|---|---|---|---|
| QGIS 3.22+ | `qgis/surgespace` (Python) | copy the folder into the QGIS plugins folder, enable it in Plugins → Manage | tested inside QGIS 3.34 (`qgis/tests/test_plugin.py`, also in CI) |
| ArcGIS Pro 3.x | `arcgis/SurgeSpace.pyt` (Python toolbox) | Catalog → Toolboxes → Add Toolbox | written; checked for syntax; to be tested in ArcGIS Pro |
| AutoCAD, BricsCAD, ZWCAD | `autocad/SurgeSpace.lsp` (AutoLISP) | APPLOAD the file; commands SSEXPORT, SSRESULTS | written; to be tested in AutoCAD |
| MicroStation | none needed | File → Import / Export DXF (SurgeSpace DXF uses layers SS_*) | DXF R12, read back by SurgeSpace's own DXF importer in the tests |

The exchange formats themselves are tested in `tests/phase5.test.ts` (GeoJSON round trip with the same steady
heads; GIS lines with other field names and 3-D vertices; DXF read back as the same network).
