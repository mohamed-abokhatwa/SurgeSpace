// Arabic edition of the detailed report: headings, table headers and labels in Arabic, right-to-left layout.
// Numbers, element ids and units stay as they are; free-text details written by the engine stay in English.
const PHRASES: [string, string][] = [
  ['transient analysis report', 'تقرير تحليل الطرق المائي (الظواهر العابرة)'],
  ['Report narrative', 'السرد الفني للتقرير'], ['Drafted with the SurgeSpace AI copilot from the model and results below, then reviewed by the engineer.', 'صيغ بمساعدة المساعد الذكي في SurgeSpace من النموذج والنتائج أدناه، ثم راجعه المهندس.'],
  ['1. Summary of findings', '١. ملخص النتائج'], ['2. Model and method', '٢. النموذج وطريقة الحساب'], ['3. Input data', '٣. البيانات المدخلة'],
  ['3.1 Pipes', '٣.١ الأنابيب'], ['3.2 Nodes', '٣.٢ العقد'], ['3.3 Pumps', '٣.٣ المضخات'], ['3.4 Valves', '٣.٤ المحابس'], ['3.5 Protection devices', '٣.٥ أجهزة الحماية'],
  ['4. Results by node', '٤. النتائج عند العقد'], ['5. Results by pipe', '٥. النتائج على الأنابيب'], ['6. Protection devices and slams', '٦. أجهزة الحماية والصدمات'],
  ['7. Design checks', '٧. فحوصات التصميم'], ['8. Time histories', '٨. السلاسل الزمنية'], ['9. Notes from the solver', '٩. ملاحظات من المحرك الحسابي'],
  ['Unbalanced axial forces (anchors and thrust blocks)', 'القوى المحورية غير المتوازنة (المراسي وكتل الدفع)'],
  ['Pumps, devices and valves', 'المضخات والأجهزة والمحابس'], ['To fix', 'يجب معالجته'], ['Warnings', 'تحذيرات'], ['Notes', 'ملاحظات'], ['Slams', 'الصدمات'],
  ['No check failed.', 'لم يفشل أي فحص.'],
  ['Project no.', 'رقم المشروع'], ['Client', 'العميل'], ['Event', 'الحدث'], ['Prepared by', 'إعداد'], ['Checked by', 'تدقيق'], ['Revision', 'الإصدار'], ['Date', 'التاريخ'], ['Software', 'البرنامج'],
  ['Item', 'البند'], ['Result', 'النتيجة'], ['Setting', 'الإعداد'], ['Value', 'القيمة'], ['Where', 'الموقع'], ['Device', 'الجهاز'], ['Data', 'البيانات'], ['Level', 'المستوى'], ['Check', 'الفحص'], ['Detail', 'التفاصيل'],
  ['Pipe', 'الأنبوب'], ['Node', 'العقدة'], ['Pump', 'المضخة'], ['Valve', 'المحبس'], ['From', 'من'], ['To', 'إلى'], ['Type', 'النوع'], ['Status', 'الحالة'],
  ['Suction', 'السحب'], ['Discharge', 'الطرد'], ['Head curve', 'منحنى الرفع'], ['Eff.', 'الكفاءة'], ['Check valve', 'محبس عدم الرجوع'], ['Control', 'التحكم'], ['Characteristic', 'الخاصية'], ['Stroke', 'الشوط'], ['K open', 'K مفتوح'], ['Minor K', 'K الفواقد الثانوية'],
  ['Highest pressure', 'أعلى ضغط'], ['Lowest pressure', 'أدنى ضغط'], ['Column separation', 'انفصال عمود الماء'], ['Design checks', 'فحوصات التصميم'],
  ['Simulation length', 'مدة المحاكاة'], ['Time step', 'خطوة الزمن'], ['Wave-speed adjustment', 'تعديل سرعة الموجة'], ['Friction', 'الاحتكاك'], ['Unsteady friction', 'الاحتكاك غير المستقر'],
  ['Liquid', 'السائل'], ['Units', 'الوحدات'], ['Demands', 'الاستهلاكات'], ['Minimum pressure limit', 'حد الضغط الأدنى'],
  ['Largest force (kN)', 'أكبر قوة (كيلونيوتن)'], ['Steady (kN)', 'المستقرة (كيلونيوتن)'], ['Surge part (kN)', 'جزء الطرق (كيلونيوتن)'], ['at (s)', 'عند (ث)'],
  ['Class (% used)', 'الفئة (٪ المستخدم)'], ['Cavity (L)', 'التجويف (لتر)'], ['a adjusted', 'تعديل a'], ['Time (s)', 'الزمن (ث)'], ['t max (s)', 'زمن الأقصى (ث)'], ['t min (s)', 'زمن الأدنى (ث)'],
  ['pass', 'ناجح'], ['fail', 'راسب'], ['warn', 'تحذير'], ['info', 'معلومة'],
];
const PREFIX: [RegExp, string][] = [
  [/^Steady head \(/, 'الرفع المستقر ('], [/^Steady p \(/, 'الضغط المستقر ('], [/^Steady Q \(/, 'التصرف المستقر ('], [/^Max head \(/, 'أقصى منسوب ('], [/^Min head \(/, 'أدنى منسوب ('],
  [/^Max p \(/, 'أقصى ضغط ('], [/^Min p \(/, 'أدنى ضغط ('], [/^Length \(/, 'الطول ('], [/^ID \(/, 'القطر الداخلي ('], [/^Class \(/, 'الفئة ('], [/^Level \(/, 'المنسوب ('],
  [/^Demand \(/, 'الاستهلاك ('], [/^a \(/, 'سرعة الموجة ('], [/^rpm$/, 'السرعة (د/د)'], [/^I \(/, 'عزم القصور ('], [/^at \(/, 'عند ('], [/^Water level \(/, 'منسوب الماء ('], [/^V \(/, 'السرعة ('], [/^Water stopped \(/, 'سرعة الماء المتوقف ('], [/^Slam surge/, 'طرق الصدمة'], [/^Peak pressure after \(/, 'الذروة بعدها ('],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Translate a report built in English to the Arabic edition. */
export function toArabic(html: string): string {
  let out = html.replace('<html lang="en">', '<html lang="ar" dir="rtl">');
  out = out.replace('</style>', `body{direction:rtl;font-family:"Segoe UI","Noto Naskh Arabic","Arial",sans-serif}table{direction:rtl}td,th{text-align:right}td,p,li,figcaption{unicode-bidi:plaintext}.mono,code,svg{direction:ltr}</style>`);
  for (const [en, ar] of [...PHRASES].sort((a, b) => b[0].length - a[0].length)) out = out.replace(new RegExp(`>${esc(en)}<`, 'g'), `>${ar}<`).replace(new RegExp(`>${esc(en)}:`, 'g'), `>${ar}:`);
  out = out.replace(/<th>([^<]*)<\/th>/g, (m, t: string) => { for (const [re, ar] of PREFIX) if (re.test(t)) return `<th>${t.replace(re, ar)}</th>`; return m; });
  out = out.replace(/<td>([^<]*)<\/td>/g, (m, t: string) => { for (const [re, ar] of PREFIX) if (re.test(t)) return `<td>${t.replace(re, ar)}</td>`; return m; });
  out = out.replace('SurgeSpace · transient analysis report', 'SurgeSpace · تقرير تحليل الطرق المائي');
  return out;
}
