# A small rising-main long-section drawing (vector PDF, A3 landscape) for the "model from documents" test.
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
import sys

out = sys.argv[1] if len(sys.argv) > 1 else 'long-section.pdf'
W, H = landscape(A3)
c = canvas.Canvas(out, pagesize=(W, H))
c.setTitle('Rising main long section')
c.setLineWidth(1.4); c.rect(20, 20, W - 40, H - 40)
c.setFont('Helvetica-Bold', 16); c.drawString(40, H - 50, 'RISING MAIN FROM PS-1 TO HILL TANK - LONG SECTION')
c.setFont('Helvetica', 11); c.drawString(40, H - 70, 'PIPE: DN600 DUCTILE IRON K9, PN25    DESIGN FLOW 320 L/s (2 DUTY + 1 STANDBY PUMPS)')
pts = [(0, 100.0), (1200, 115.0), (2600, 140.0), (3800, 120.0), (5000, 130.0)]
x0, x1, z0, z1, y0, y1 = 120, W - 80, 90, 150, 260, H - 120
X = lambda ch: x0 + ch / 5000 * (x1 - x0)
Y = lambda z: y0 + (z - z0) / (z1 - z0) * (y1 - y0)
c.setLineWidth(2.2)
p = c.beginPath(); p.moveTo(X(0), Y(100))
for ch, z in pts[1:]: p.lineTo(X(ch), Y(z))
c.drawPath(p)
# sump and tank water levels
c.setFont('Helvetica', 9)
c.line(X(0) - 40, Y(98), X(0), Y(98)); c.drawString(X(0) - 60, Y(98) + 4, 'SUMP TWL 98.00')
c.line(X(5000), Y(134), X(5000) + 30, Y(134)); c.drawString(X(5000) - 40, Y(134) + 6, 'TANK TWL 134.00')
# air valve symbol at CH 1+950 and washout at the low point
ch = 1950; z = 115 + (ch - 1200) / 1400 * 25
c.circle(X(ch), Y(z) + 18, 5); c.line(X(ch), Y(z), X(ch), Y(z) + 13)
c.drawString(X(ch) + 8, Y(z) + 16, 'ARV DN100 CH 1+950')
c.drawString(X(3800) - 30, Y(120) - 16, 'WO DN150 CH 3+800')
# chainage / level table
c.setFont('Helvetica-Bold', 9)
c.drawString(30, 200, 'CHAINAGE (m)'); c.drawString(30, 180, 'PIPE INVERT (m)'); c.drawString(30, 160, 'GROUND LEVEL (m)')
c.setFont('Helvetica', 9)
for ch, z in pts:
    c.drawCentredString(X(ch), 200, f'{ch:.0f}'); c.drawCentredString(X(ch), 180, f'{z:.2f}'); c.drawCentredString(X(ch), 160, f'{z + 1.5:.2f}')
c.line(25, 192, W - 25, 192); c.line(25, 172, W - 25, 172)
c.drawString(40, 60, 'PUMPS: 2 DUTY, 160 L/s @ 47 m EACH, 1480 rpm')
c.save()
