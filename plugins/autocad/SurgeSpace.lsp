;;; SurgeSpace for AutoCAD / BricsCAD / ZWCAD (AutoLISP, no installation: APPLOAD this file).
;;;  SSEXPORT  - writes the polylines and lines on a chosen layer to a GeoJSON file that SurgeSpace opens with
;;;              File -> Import GIS layer. 3-D polylines keep their vertex elevations (long section).
;;;              Diameter is read from the layer name if it ends with a number in mm (e.g. "WATER-DN300").
;;;  SSRESULTS - inserts a SurgeSpace DXF export (File -> Export CAD) as a block, so the pipes over their
;;;              pressure class (layer SS_OVER_CLASS) and the result texts (SS_RESULTS) overlay the drawing.

(defun ss:num-suffix (s / i n)
  (setq i (strlen s) n "")
  (while (and (> i 0) (wcmatch (substr s i 1) "#")) (setq n (strcat (substr s i 1) n) i (1- i)))
  (if (= n "") nil (atoi n)))

(defun ss:pts (e / d pts)
  (setq d (entget e))
  (cond
    ((= (cdr (assoc 0 d)) "LINE") (list (cdr (assoc 10 d)) (cdr (assoc 11 d))))
    ((= (cdr (assoc 0 d)) "LWPOLYLINE")
     (foreach p d (if (= (car p) 10) (setq pts (cons (list (cadr p) (caddr p) (if (assoc 38 d) (cdr (assoc 38 d)) 0.0)) pts))))
     (reverse pts))
    ((= (cdr (assoc 0 d)) "POLYLINE")
     (setq e (entnext e))
     (while (= (cdr (assoc 0 (setq d (entget e)))) "VERTEX")
       (setq pts (cons (cdr (assoc 10 d)) pts) e (entnext e)))
     (reverse pts))))

(defun ss:num (x) (rtos x 2 3))

(defun c:SSEXPORT (/ lay ss f path i e pts dn first cs)
  (setq lay (getstring T "\nLayer with the pipes: "))
  (setq ss (ssget "X" (list (cons 8 lay) (cons 0 "LINE,LWPOLYLINE,POLYLINE"))))
  (if (not ss) (progn (princ "\nNo lines or polylines on that layer.") (exit)))
  (setq path (getfiled "Save for SurgeSpace" "" "geojson" 1))
  (if (not path) (exit))
  (setq dn (ss:num-suffix lay) f (open path "w") first T)
  (write-line "{\"type\":\"FeatureCollection\",\"features\":[" f)
  (setq i 0)
  (repeat (sslength ss)
    (setq e (ssname ss i) pts (ss:pts e))
    (if (> (length pts) 1)
      (progn
        (if (not first) (write-line "," f))
        (setq first nil)
        (princ (strcat "{\"type\":\"Feature\",\"properties\":{\"id\":\"" lay "-" (itoa (1+ i)) "\",\"layer\":\"pipes\""
                       (if dn (strcat ",\"diameter_mm\":" (itoa dn)) "") "},\"geometry\":{\"type\":\"LineString\",\"coordinates\":[") f)
        (setq cs "")
        (foreach p pts (setq cs (strcat cs (if (= cs "") "" ",") "[" (ss:num (car p)) "," (ss:num (cadr p)) "," (ss:num (if (caddr p) (caddr p) 0.0)) "]")))
        (princ cs f)
        (princ "]}}" f)))
    (setq i (1+ i)))
  (write-line "]}" f)
  (close f)
  (princ (strcat "\n" (itoa (sslength ss)) " pipes written. In SurgeSpace: File -> Import GIS layer (GeoJSON)."))
  (princ))

(defun c:SSRESULTS (/ path)
  (setq path (getfiled "SurgeSpace DXF export" "" "dxf" 0))
  (if path (command "_.-INSERT" (strcat "*" path) '(0 0 0) 1 0))
  (princ "\nSurgeSpace results inserted (layers SS_PIPES, SS_OVER_CLASS, SS_RESULTS, SS_LABELS).")
  (princ))

(princ "\nSurgeSpace loaded: SSEXPORT, SSRESULTS.")
(princ)
