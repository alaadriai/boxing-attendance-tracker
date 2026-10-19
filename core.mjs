export const SCHEMA_VERSION = 2;
export const ZONE = 'Europe/Berlin';
export const OUTCOMES = ['taught', 'cancelled', 'substituted'];

export function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function dateObject(date) { return new Date(`${date}T12:00:00Z`); }
export function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(dateObject(date).getTime()) && dateObject(date).toISOString().slice(0,10) === date;
}
export function shiftDate(date, days) {
  const d = dateObject(date); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10);
}
export function dayOfWeek(date) { return dateObject(date).getUTCDay(); }
export function calendarWeek(date) {
  const d=dateObject(date),day=d.getUTCDay()||7;
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate()+4-day);
  const year=d.getUTCFullYear(),start=new Date(Date.UTC(year,0,1));
  return {year,week:Math.ceil(((d-start)/86400000+1)/7)};
}
export function weekLabel(date) { const {year,week}=calendarWeek(date);return `Week ${String(week).padStart(2,'0')} / ${year}`; }
export function dateLabel(date, options = {}) {
  return validDate(date) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...options }).format(dateObject(date)) : 'Unknown date';
}
export const sessionKey = (courseId, date) => `${courseId}_${date}`;
export const periodFor = (config, date) => config.periods.find(p => date >= p.start && date <= p.end);
export function courseFor(config, courseId, date) {
  return periodFor(config, date)?.courses.find(c => c.id === courseId) || { id: courseId, name: { c1: 'Boxing Level 1', c2: 'Boxing Fitness / Monday late', c3: 'Boxing Level 1-2' }[courseId] || courseId, start: '', end: '', day: null, rate: null, units: null, listings: [] };
}
export function scheduledOn(config, date) {
  const period = periodFor(config, date);
  return (period?.courses || []).filter(c => c.day === dayOfWeek(date) && date >= (c.from || period.start) && date <= (c.until || period.end))
    .map(course => ({ ...course, date, periodId: period.id, holiday: nrwHoliday(date) })).sort((a,b) => a.start.localeCompare(b.start));
}
export function scheduledSessions(config, periodId, until = '9999-12-31') {
  const period = config.periods.find(p => p.id === periodId); if (!period) return [];
  const rows = [];
  for (let date = period.start; date <= period.end && date <= until; date = shiftDate(date, 1)) rows.push(...scheduledOn(config, date));
  return rows;
}
export function normalizeRecord(record) {
  return { ...record, status: record.status || (record.cancelled ? 'cancelled' : 'taught'), count: record.count === null ? null : Number(record.count ?? 0), revision: record.revision || 1 };
}
export function groupRecords(records) {
  const map = new Map();
  for (const raw of records) {
    if (raw.deletedAt || !validDate(raw.date)) continue;
    const record = normalizeRecord(raw), key = sessionKey(record.courseId, record.date);
    if (!map.has(key)) map.set(key, []); map.get(key).push(record);
  }
  return map;
}
export function missingSessions(config, records, today = localDate()) {
  const groups = groupRecords(records);
  return config.periods.flatMap(p => scheduledSessions(config, p.id, shiftDate(today, -1)))
    .filter(s => !groups.has(sessionKey(s.id, s.date)) && !s.holiday).sort((a,b) => b.date.localeCompare(a.date));
}
export function detectCourse(config, date = localDate(), now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minutes = +parts.find(p => p.type === 'hour').value * 60 + +parts.find(p => p.type === 'minute').value;
  const options = scheduledOn(config, date);
  const startM = c => +c.start.slice(0,2) * 60 + +c.start.slice(3);
  const endM = c => +c.end.slice(0,2) * 60 + +c.end.slice(3);
  return options.find(c => minutes >= startM(c) && minutes <= endM(c)) || options.slice().sort((a,b) => Math.abs(startM(a)-minutes) - Math.abs(startM(b)-minutes))[0];
}
export function validateSession(record, today = localDate()) {
  if (!validDate(record.date)) return 'Choose a valid class date.';
  if (!OUTCOMES.includes(record.status)) return 'Choose a session outcome.';
  if (record.date > today && record.status !== 'cancelled') return 'Only cancellations can be recorded for future dates.';
  if (record.count !== null && (!Number.isInteger(record.count) || record.count < 0 || record.count > 999)) return 'Headcount must be a whole number between 0 and 999.';
  if (record.status === 'cancelled' && !record.reason?.trim()) return 'Choose or enter a cancellation reason.';
  if (record.status === 'substituted' && !record.substituteName?.trim()) return 'Enter the substitute instructor.';
  return null;
}
export function validateConfig(config) {
  if (!config || !Array.isArray(config.periods) || !config.periods.length) return 'Add at least one billing period.';
  const ids = new Set();
  for (const p of config.periods) {
    if (!p.id || ids.has(p.id)) return 'Period IDs must be unique.'; ids.add(p.id);
    if (!p.name?.trim() || !validDate(p.start) || !validDate(p.end) || p.end < p.start) return 'Check the period name and dates.';
    if (!p.courses?.length) return 'Add at least one course per period.';
    const courseIds = new Set();
    for (const c of p.courses) {
      if (!/^[a-zA-Z0-9_-]+$/.test(c.id) || courseIds.has(c.id)) return 'Course IDs must be unique within each period.'; courseIds.add(c.id);
      if (!c.name?.trim() || !Number.isInteger(c.day) || c.day < 0 || c.day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.end) || c.end <= c.start) return 'Check course names, weekdays, and start/end times.';
      if (c.rate !== null && (!Number.isFinite(c.rate) || c.rate < 0)) return 'Rates must be zero or positive.';
      if (c.units !== null && (!Number.isFinite(c.units) || c.units <= 0)) return 'Teaching units must be greater than zero.';
      if (c.from && (!validDate(c.from) || c.from < p.start || c.from > p.end)) return 'Course start must fall inside the billing period.';
      if (c.until && (!validDate(c.until) || c.until < (c.from || p.start) || c.until > p.end)) return 'Course end must fall inside the billing period.';
    }
  }
  const sorted = [...config.periods].sort((a,b) => a.start.localeCompare(b.start));
  for (let i=1;i<sorted.length;i++) if (sorted[i].start <= sorted[i-1].end) return 'Billing periods cannot overlap.';
  return null;
}
export function billingReview(config, records, periodId, today = localDate()) {
  const groups = groupRecords(records), scheduled = scheduledSessions(config, periodId);
  const rows = scheduled.map(s => {
    const matching = groups.get(sessionKey(s.id,s.date)) || [], r = matching.length === 1 ? matching[0] : null;
    const conflict = matching.length > 1;
    const review = conflict ? 'Duplicate records' : !r && s.holiday ? 'Holiday' : !r ? (s.date < today ? 'Missing outcome' : 'Upcoming') : r.status === 'substituted' ? 'Substitute: review payment' : r.status === 'taught' && s.holiday ? 'Taught on holiday: review' : '';
    const billable = !!r && r.status === 'taught' && !s.holiday;
    return { ...s, courseId:s.id, record:r, records:matching, status:r?.status || 'planned', review, billable, amount:billable && s.rate !== null && s.units !== null ? s.rate*s.units : null };
  });
  const period = config.periods.find(p=>p.id===periodId);
  if (!period) return rows;
  const scheduledKeys = new Set(rows.map(s => sessionKey(s.courseId,s.date)));
  for (const [key,matching] of groups) {
    const r = matching[0];
    if (r.date < period.start || r.date > period.end || scheduledKeys.has(key)) continue;
    const c = courseFor(config,r.courseId,r.date);
    rows.push({...c,date:r.date,courseId:r.courseId,record:matching.length===1?r:null,records:matching,status:r.status,review:'Outside configured schedule: review',billable:false,amount:null});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
}
export function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function nrwHoliday(date) {
  const year=+date.slice(0,4),fixed={'01-01':"New Year's Day",'05-01':'Labour Day','10-03':'German Unity Day','11-01':"All Saints' Day",'12-25':'Christmas Day','12-26':'Second Christmas Day'};
  if(fixed[date.slice(5)])return fixed[date.slice(5)];
  const e=easter(year);
  return [[-2,'Good Friday'],[1,'Easter Monday'],[39,'Ascension Day'],[50,'Whit Monday'],[60,'Corpus Christi']].find(([offset])=>shiftDate(e,offset)===date)?.[1]||null;
}
export function csv(rows) {
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    let s=String(value??''); if(/^[=+@\-\t\r]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
export const defaultConfig = {
  schemaVersion:SCHEMA_VERSION, periods:[{
    id:'ws2026-1',name:'Winter 2026/27 / Period 1',start:'2026-10-19',end:'2026-12-22',
    courses:[
      {id:'c1',name:'Boxing Level 1',day:1,start:'20:00',end:'21:25',rate:12,units:1.5,listings:['33331117','33331118'],location:'HSZ Aachen'},
      {id:'c2',name:'Box Fitness',day:1,start:'21:30',end:'22:55',rate:16,units:1.5,listings:['33231111','33231113'],location:'HSZ Aachen'},
      {id:'c3',name:'Boxing Level 1-2',day:4,start:'20:30',end:'21:55',until:'2026-12-17',rate:12,units:1.5,listings:['33331147','33331148'],location:'HSZ Aachen'}
    ]
  }]
};
