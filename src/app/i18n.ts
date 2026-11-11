// Interface language (English / Arabic). Menus, ribbon, tabs and the contents of the panels and dialogs are translated; the layout turns
// right-to-left in Arabic. Engineering terms that have no settled Arabic form keep their English name.
import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'ar';
let lang: Lang = (() => { try { return (localStorage.getItem('surgespace.lang') as Lang) || 'en'; } catch { return 'en'; } })();
const subs = new Set<() => void>();
export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('surgespace.lang', l); } catch { /* storage blocked */ }
  applyDir();
  subs.forEach((f) => f());
}
export function applyDir() { if (typeof document !== 'undefined') { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; } }
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getLang, getLang);

const AR: Record<string, string> = {
  // menus
  File: 'ملف', Edit: 'تحرير', View: 'عرض', Model: 'النموذج', Analysis: 'التحليل', Results: 'النتائج', Tools: 'أدوات', AI: 'الذكاء الاصطناعي', Help: 'مساعدة',
  'New model': 'نموذج جديد', 'Open project…': 'فتح مشروع…', 'Open example': 'فتح مثال', 'Recover autosaved model': 'استعادة النسخة المحفوظة تلقائيًا', 'Save project': 'حفظ المشروع',
  'Import (EPANET, spreadsheet, long section, DXF)…': 'استيراد (EPANET، جدول، قطاع طولي، DXF)…', 'Import GIS layer (GeoJSON)…': 'استيراد طبقة GIS (GeoJSON)…',
  'Export EPANET .inp': 'تصدير EPANET .inp', 'Export GIS (GeoJSON, with results)': 'تصدير GIS (GeoJSON مع النتائج)', 'Export CAD (DXF, with results)': 'تصدير CAD (DXF مع النتائج)',
  'Export envelopes .csv': 'تصدير الأغلفة .csv', 'Export results workbook (Excel .xlsx)': 'تصدير مصنف النتائج (Excel)', 'Project details…': 'بيانات المشروع…', 'Detailed report…': 'التقرير التفصيلي…',
  Undo: 'تراجع', Redo: 'إعادة', 'Select all': 'تحديد الكل', 'Clear selection': 'إلغاء التحديد', 'Duplicate nodes': 'تكرار العقد', Delete: 'حذف', 'Find element…': 'بحث عن عنصر…',
  'Zoom to fit': 'ملاءمة العرض', Grid: 'الشبكة', 'Snap to grid': 'الالتقاط للشبكة', 'Element IDs': 'أرقام العناصر', 'Map and terrain (basemap, elevations)…': 'الخريطة والتضاريس (خريطة أساس، مناسيب)…',
  'Background picture…': 'صورة الخلفية…', 'North arrow': 'سهم الشمال', 'Value labels': 'عناوين القيم', Contours: 'خطوط الكنتور', 'Colour pipes by': 'تلوين الأنابيب حسب',
  'Model Explorer panel': 'لوحة مستكشف النموذج', 'Properties panel': 'لوحة الخصائص', 'Results dock': 'منطقة النتائج', Theme: 'المظهر', Language: 'اللغة',
  'Select / move': 'تحديد / تحريك', Pan: 'تحريك العرض', Network: 'الشبكة', Links: 'الوصلات', 'Protection devices': 'أجهزة الحماية', 'Operations…': 'العمليات…', 'Cases…': 'الحالات…', 'Data sheets': 'جداول البيانات',
  'Pipe lengths from drawing (all)': 'أطوال الأنابيب من الرسم (الكل)', 'Pipe lengths from drawing (selected)': 'أطوال الأنابيب من الرسم (المحدد)',
  'Model Health Check…': 'فحص سلامة النموذج…', 'Run Setup…': 'إعدادات التشغيل…', 'Run surge': 'تشغيل تحليل الطرق', 'Uncertainty (worst case)': 'عدم اليقين (أسوأ حالة)',
  'Extended period (daily operation, water quality)…': 'المحاكاة الممتدة (التشغيل اليومي، جودة المياه)…', 'Run extended period': 'تشغيل المحاكاة الممتدة', 'Surge engine': 'محرك تحليل الطرق',
  'Wave (method of characteristics) — fast events': 'موجي (طريقة الخواص) — الأحداث السريعة', 'Rigid column — slow events, mass oscillation': 'العمود الصلب — الأحداث البطيئة وتذبذب الكتلة',
  'Optimise protection (genetic algorithm)': 'تحسين الحماية (خوارزمية جينية)', 'Skeletonise model (new case)': 'تبسيط النموذج (حالة جديدة)', 'Live data and field data…': 'البيانات الحية والميدانية…',
  'Size protection (vessel, air valves)…': 'تحجيم الحماية (خزان هوائي، محابس هواء)…', 'Run all cases and compare': 'تشغيل كل الحالات والمقارنة',
  'Design view (no results)': 'عرض التصميم (بدون نتائج)', 'Surge animation': 'حركة الطرق', 'Pressure animation': 'حركة الضغط', 'Maximum pressure': 'أقصى ضغط', 'Minimum pressure': 'أدنى ضغط', 'Steady pressure': 'الضغط المستقر',
  'Long-section profile': 'القطاع الطولي', Graphs: 'الرسوم البيانية', 'Design checks': 'فحوصات التصميم', 'Result tables': 'جداول النتائج', 'Run log': 'سجل التشغيل',
  'Catalogues & wave speed calculator…': 'الكتالوجات وحاسبة سرعة الموجة…', Units: 'الوحدات', 'SI (metric)': 'النظام المتري', 'US customary': 'النظام الأمريكي', 'More unit options…': 'خيارات وحدات أخرى…',
  'Element defaults…': 'القيم الافتراضية للعناصر…', 'Script console…': 'وحدة البرمجة النصية…', 'Licence…': 'الترخيص…',
  Copilot: 'المساعد', 'AI accounts…': 'حسابات الذكاء الاصطناعي…', 'Explain the results': 'شرح النتائج', 'Review my model': 'مراجعة النموذج', 'Design the protection': 'تصميم الحماية', 'Draft the report narrative': 'صياغة سرد التقرير',
  'Review daily operation': 'مراجعة التشغيل اليومي', 'Scope the surge cases': 'تحديد حالات الطرق',
  'Quick start': 'البدء السريع', 'Keyboard shortcuts': 'اختصارات لوحة المفاتيح', 'Questions and ideas…': 'أسئلة واقتراحات…', 'About SurgeSpace': 'حول SurgeSpace',
  // ribbon
  New: 'جديد', Open: 'فتح', Save: 'حفظ', Import: 'استيراد', Select: 'تحديد', Project: 'المشروع', 'Surge protection': 'الحماية من الطرق',
  Source: 'مصدر', 'Var. source': 'مصدر متغير', Junction: 'عقدة', Pipe: 'أنبوب', Pump: 'مضخة', Turbine: 'توربين', Valve: 'محبس', Orifice: 'فتحة',
  Vessel: 'خزان هوائي', 'Air valve': 'محبس هواء', Standpipe: 'خزان موازنة', 'Feed tank': 'خزان تغذية', Anticipator: 'محبس استباقي', Relief: 'محبس تنفيس', Blowoff: 'تفريغ', 'Burst disc': 'قرص انفجار',
  Review: 'مراجعة', Protect: 'حماية', Explain: 'شرح', Check: 'فحص', Setup: 'إعداد', Catalogues: 'الكتالوجات', Run: 'تشغيل', 'Run*': 'تشغيل*', Running: 'جارٍ التشغيل', Report: 'تقرير',
  // panes and tabs
  Explorer: 'المستكشف', Operations: 'العمليات', Library: 'المكتبة', Properties: 'الخصائص', Profile: 'القطاع', Cases: 'الحالات', 'Protection sizing': 'تحجيم الحماية', Uncertainty: 'عدم اليقين',
  'Daily operation': 'التشغيل اليومي', 'Live data': 'البيانات الحية', Design: 'التصميم', Surge: 'الطرق', Pressure: 'الضغط', Max: 'الأقصى', Min: 'الأدنى', Steady: 'المستقر',
};

/** Translate an interface string (unknown strings stay as they are). Counts like "Cases · 3" keep their suffix. */
export function tr(s: string): string {
  if (lang === 'en' || !s) return s;
  if (AR[s]) return AR[s];
  // the panel dictionary too, once loaded (text built from several parts is not matched as a whole when drawn)
  if (ALL_AR[s]) return ALL_AR[s];
  const m = /^(.*?)( · \d+)$/.exec(s);
  if (m && AR[m[1]]) return AR[m[1]] + m[2];
  const k = /^(.*?)( \(run first\))$/.exec(s);
  if (k && AR[k[1]]) return `${AR[k[1]]} (شغّل أولًا)`;
  return s;
}

// ── panel contents: translate the interface text as it is drawn ──
let ALL_AR: Record<string, string> = { ...AR };
let panelsLoaded: Promise<void> | null = null;
/** The panel dictionary is loaded only when the interface is in Arabic. */
function loadPanels(): Promise<void> {
  panelsLoaded ??= import('./i18n-panels').then((m) => { ALL_AR = { ...m.AR_PANELS, ...AR }; });
  return panelsLoaded;
}
const SKIP = 'TEXTAREA, INPUT, CODE, PRE, SCRIPT, STYLE, .md, .no-tr, [contenteditable]';
const original = new WeakMap<Node, string>();
const originalTitle = new WeakMap<Element, string>();
/** The Arabic for a whole interface string, keeping a trailing colon or ellipsis and surrounding spaces. */
export function trText(s: string): string | null {
  const m = /^(\s*)(.*?)(\s*)$/s.exec(s);
  if (!m || !m[2]) return null;
  const core = m[2];
  const hit = ALL_AR[core] ?? (core.endsWith(':') && ALL_AR[core.slice(0, -1)] ? `${ALL_AR[core.slice(0, -1)]}:` : undefined);
  return hit ? m[1] + hit + m[3] : null;
}
function translateNode(n: Node) {
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const cur = n.nodeValue ?? '';
    // a word inside an English sentence stays English, so the sentence reads as one language
    const blk = p.closest('p, .hint, li');
    if (blk && (blk.textContent ?? '').trim() !== cur.trim() && lang === 'ar') return;
    if (lang === 'ar') {
      const t = trText(cur);
      if (t && t !== cur) { original.set(n, cur); n.nodeValue = t; }
    } else {
      const o = original.get(n);
      if (o !== undefined && trText(o) === cur) n.nodeValue = o;
    }
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (el.matches(SKIP)) return;
  const title = el.getAttribute('title');
  if (title) {
    if (lang === 'ar') { const t = trText(title); if (t) { originalTitle.set(el, title); el.setAttribute('title', t); } }
    else { const o = originalTitle.get(el); if (o && trText(o) === title) el.setAttribute('title', o); }
  }
  el.childNodes.forEach(translateNode);
}
let observer: MutationObserver | null = null;
/** Keep the panels of `root` in the interface language (call once at start). */
export function startPanelTranslation(root: HTMLElement) {
  if (typeof MutationObserver === 'undefined' || observer) return;
  observer = new MutationObserver((muts) => {
    if (lang === 'en') return;
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
  const run = () => { if (lang === 'ar') void loadPanels().then(() => translateNode(root)); else translateNode(root); };
  run();
  subs.add(run);
}
