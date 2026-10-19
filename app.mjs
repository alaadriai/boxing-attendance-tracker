import {SCHEMA_VERSION,localDate,validDate,shiftDate,dateLabel,weekLabel,calendarWeek,periodFor,courseFor,scheduledOn,scheduledSessions,sessionKey,groupRecords,missingSessions,detectCourse,validateSession,validateConfig,billingReview,csv,nrwHoliday} from './core.mjs';
import {createStore,drafts} from './store.mjs';
import {PeopleView} from './people.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name}"></i>`;
const euro=value=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(value);
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const views=[['desk','clipboard-pen','Session desk'],['history','history','History'],['people','users-round','People'],['period','calendar-range','Period review'],['insights','chart-no-axes-combined','Insights']];
let view=location.hash.slice(1)||'desk',date=localDate(),selectedId='',form=null,dirty=false,saveBusy=false,showAll=false,filterCourse='all',filterPeriod='all',search='',periodId='',settingsDraft=null,toastTimer;
const store=createStore(onState),state=store.state;
const peopleView=new PeopleView({config:()=>state.config,render,modal,toast,esc,icon,demo:state.demo});
let lastConfig=JSON.stringify(state.config);
const activeDraft=drafts.get('active');
if(activeDraft&&validDate(activeDraft.date)&&drafts.get(sessionKey(activeDraft.courseId,activeDraft.date))){date=activeDraft.date;selectedId=activeDraft.courseId;}
function onState(){
  renderSync();
  const changed=JSON.stringify(state.config)!==lastConfig;lastConfig=JSON.stringify(state.config);
  if(!dirty&&form){const matches=groupRecords(state.records).get(sessionKey(selectedId,date))||[];const r=matches.length===1?matches[0]:null;if(r)form={...form,...r,unknown:r.count===null};}
  if(!$('#main').contains(document.activeElement)||changed)render();
}
function icons(){window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});}
function renderSync(){
  const conflict=state.queue.some(q=>q.error==='conflict');
  const label=state.demo?'Preview / local data':conflict?'Sync conflict':state.queue.length?`${state.queue.length} saved locally`:state.connected?'All changes synced':state.ready?'Offline / local copy':'Connecting';
  $('#sync').textContent=label;$('#sync').className=`sync ${conflict||state.error?'error':state.connected&&!state.queue.length?'ok':''}`;
  $('#sync').title=state.error||label;$('#retry-sync').hidden=state.connected&&!state.queue.length;
}
function toast(message,undo){
  const el=$('#toast');clearTimeout(toastTimer);el.innerHTML=`<span>${esc(message)}</span>${undo?'<button type="button">Undo</button>':''}`;el.classList.add('visible');
  if(undo)el.querySelector('button').onclick=async()=>{try{await undo();el.classList.remove('visible');render();}catch(e){toast(e.message);}};
  toastTimer=setTimeout(()=>el.classList.remove('visible'),undo?12000:4300);
}
function navigate(next){view=next;location.hash=next;settingsDraft=null;render();window.scrollTo(0,0);}
function tag(r,conflict=false){const status=conflict?'conflict':r?.status||'planned';return `<span class="tag ${esc(status)}">${conflict?'Duplicate records':r?status==='taught'?(r.count===null?'Taught / count unknown':'Recorded'):status==='cancelled'?'Cancelled':'Substitute':'Unconfirmed'}${r?._pending?' / local':''}</span>`;}
function activePeriod(){return state.config.periods.find(p=>p.id===periodId)||periodFor(state.config,localDate())||state.config.periods.at(-1);}
function choose(courseId,newDate=date){
  selectedId=courseId;date=newDate;const matches=groupRecords(state.records).get(sessionKey(courseId,date))||[];
  const r=matches.length===1?matches[0]:null,course=courseFor(state.config,courseId,date),cached=drafts.get(sessionKey(courseId,date));
  form=cached||{id:r?.id||sessionKey(courseId,date),courseId,date,count:r?.count??0,status:r?.status||'taught',reason:r?.reason||'',notes:r?.notes||'',substituteName:r?.substituteName||'',time:r?.time||course.start,revision:r?.revision||null,unknown:r?r.count===null:false};
  dirty=!!cached;render();
}
function ensureSelection(){
  if(form&&selectedId)return;
  const course=(selectedId?courseFor(state.config,selectedId,date):null)||detectCourse(state.config,date)||scheduledOn(state.config,date)[0];
  if(course){selectedId=course.id;const r=(groupRecords(state.records).get(sessionKey(selectedId,date))||[])[0],cached=drafts.get(sessionKey(selectedId,date));form=cached||{id:r?.id||sessionKey(selectedId,date),courseId:selectedId,date,count:r?.count??0,status:r?.status||'taught',reason:r?.reason||'',notes:r?.notes||'',substituteName:r?.substituteName||'',time:r?.time||course.start,revision:r?.revision||null,unknown:r?r.count===null:false};dirty=!!cached;}
}
function draft(){dirty=true;drafts.set(sessionKey(selectedId,date),form);drafts.set('active',{date,courseId:selectedId});const label=$('#draft-state');if(label)label.textContent='Draft saved on this device';}
function render(){
  if(!['desk','history','people','period','insights','settings'].includes(view))view='desk';
  $('#navigation').innerHTML=views.map(([id,i,label])=>`<a class="nav-link ${view===id?'active':''}" href="#${id}" ${view===id?'aria-current="page"':''}>${icon(i)}<span>${label}</span></a>`).join('');
  $('#page-label').textContent=views.find(v=>v[0]===view)?.[2]||'Course settings';
  const content=view==='desk'?desk():view==='history'?history():view==='people'?peopleView.render():view==='period'?periodReview():view==='insights'?insights():settings();
  $('#main').innerHTML=(state.demo?'<div class="demo-banner">PREVIEW / Local test data</div>':'')+syncConflicts()+content;
  icons();renderSync();
}
function syncConflicts(){const qs=state.queue.filter(q=>q.error==='conflict');return qs.map(q=>`<div class="notice danger"><div><strong>A newer version exists on another device.</strong><small>${esc(courseFor(state.config,q.record.courseId,q.record.date).name)} / ${esc(dateLabel(q.record.date))}. Your local edit is preserved in the backup export.</small></div><button class="button compact" data-server="${esc(q.record.id)}">Load server version</button></div>`).join('');}
function heading(eyebrow,title,sub='',right=''){return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div>${right}</div>`;}
function desk(){
  ensureSelection();const groups=groupRecords(state.records),missing=missingSessions(state.config,state.records),duplicates=[...groups.values()].filter(g=>g.length>1);
  const scheduled=scheduledOn(state.config,date),existing=state.records.filter(r=>r.date===date&&!r.deletedAt);
  let courses=[...scheduled];
  for(const r of existing)if(!courses.some(c=>c.id===r.courseId))courses.push(courseFor(state.config,r.courseId,date));
  if(showAll||!courses.length){for(const id of new Set([...state.config.periods.flatMap(p=>p.courses.map(c=>c.id)),'c1','c2','c3']))if(!courses.some(c=>c.id===id))courses.push(courseFor(state.config,id,date));}
  const p=periodFor(state.config,date);
  const controls=`<div class="date-control"><button class="icon-button" data-day="-1" title="Previous day" aria-label="Previous day">${icon('chevron-left')}</button><label class="sr-only" for="session-date" hidden>Class date</label><input type="date" id="session-date" aria-label="Class date" value="${date}"><button class="icon-button" data-day="1" title="Next day" aria-label="Next day">${icon('chevron-right')}</button><button class="button ghost compact" data-today>Today</button></div>`;
  let html=heading('THE DAILY PRACTICE','Session desk',esc(dateLabel(date,{weekday:'long',year:'numeric'}))+` <span class="week-badge">${weekLabel(date)}</span>`+(date<localDate()?' <span class="backfill">/ Backfill</span>':''),controls);
  if(missing.length)html+=`<div class="notice"><div><strong>${missing.length} ${missing.length===1?'class needs':'classes need'} an outcome</strong><small>Most recent: ${esc(dateLabel(missing[0].date))} / ${esc(missing[0].name)}</small></div><button class="button compact ghost" data-open-missing>Fill in ${icon('arrow-up-right')}</button></div>`;
  if(duplicates.length)html+=`<div class="notice danger"><div><strong>${duplicates.length} session ${duplicates.length===1?'date has':'dates have'} duplicate records</strong><small>Excluded from totals until reviewed.</small></div><button class="button compact ghost" data-duplicates>Review</button></div>`;
  html+=`<div class="desk-layout"><section><div class="section-label"><span><span class="number">01</span> ${scheduled.length?'On the schedule':'Choose a course'}</span><span>${courses.length} ${courses.length===1?'slot':'slots'}</span></div><div class="session-list">${courses.map(c=>{const g=groups.get(sessionKey(c.id,date))||[];return `<button class="session-choice ${c.id===selectedId?'selected':''}" data-course="${esc(c.id)}" aria-pressed="${c.id===selectedId}"><div class="session-time">${esc(c.start||'Manual entry')}${c.end?' - '+esc(c.end):''}<span class="status-symbol">${icon(c.id===selectedId?'arrow-up-right':'minus')}</span></div><h3>${esc(c.name)}</h3><small>${esc(c.location||'Historical session')}</small>${tag(g[0],g.length>1)}</button>`;}).join('')}</div>${scheduled.length?'<button class="button ghost compact" style="margin-top:12px" data-all-courses>All courses</button>':''}<div class="recent-strip"><div class="section-label">${p?'Current period':'Selected date'}</div><p class="muted" style="font-size:13px;line-height:1.6">${esc(p?.name||'Outside configured periods')}<br>${p?esc(dateLabel(p.start))+' - '+esc(dateLabel(p.end,{year:'numeric'})):''}</p><button class="button ghost compact" style="margin-top:14px" data-view="period">Period review ${icon('arrow-right')}</button></div></section><section class="counter-surface">${counter()}</section></div>`;
  const recent=state.records.filter(r=>!r.deletedAt).sort((a,b)=>b.date.localeCompare(a.date)||String(b.time).localeCompare(String(a.time))).slice(0,3);
  if(recent.length)html+=`<section class="recent-strip"><div class="section-label"><span>Recent sessions</span><button class="button ghost compact" data-view="history">View all ${icon('arrow-right')}</button></div>${recent.map(r=>`<div class="recent-row"><div class="row-name"><strong>${esc(courseFor(state.config,r.courseId,r.date).name)}</strong><small>${esc(dateLabel(r.date,{weekday:'short'}))} / ${esc(r.time||'')}</small></div>${tag(r)}<span class="recent-number">${r.status==='cancelled'?'--':r.count??'?'}</span><button class="icon-button" data-edit="${esc(r.id)}" title="Edit session" aria-label="Edit ${esc(dateLabel(r.date))}">${icon('pencil')}</button></div>`).join('')}</section>`;
  return html;
}
function counter(){
  if(!form)return '<div class="empty">Choose a course to record its outcome.</div>';
  const course=courseFor(state.config,selectedId,date),matching=groupRecords(state.records).get(sessionKey(selectedId,date))||[],holiday=nrwHoliday(date),cancelled=form.status==='cancelled';
  if(matching.length>1)return `<div class="section-label"><span class="number">02 / REVIEW</span></div><div class="notice danger"><strong>Choose the correct record before editing this class.</strong></div>${duplicateRows(matching)}`;
  return `<div class="section-label"><span><span class="number">02</span> Session record</span><span>${matching.length?'Update existing':'New record'}</span></div><div class="counter-title"><div><h2>${esc(course.name)}</h2><p>${esc(dateLabel(date,{weekday:'long'}))}${course.start?' / '+esc(course.start):''}</p></div><div class="actions"><button class="icon-button" data-class-people title="Registered people" aria-label="Registered people">${icon('users-round')}</button><span class="tag">${date<localDate()?'Backfill':date>localDate()?'Scheduled':'Today'}</span></div></div>${holiday?`<div class="notice" style="margin-top:16px"><span>${esc(holiday)} / NRW public holiday</span></div>`:''}<div class="outcomes" role="group" aria-label="Session outcome">${[['taught','check','Taught'],['cancelled','calendar-x-2','Cancelled'],['substituted','users-round','Substitute']].map(([id,i,label])=>`<button class="outcome ${form.status===id?'active':''}" data-outcome="${id}" aria-pressed="${form.status===id}">${icon(i)}${label}</button>`).join('')}</div>${cancelled?`<div style="padding:22px 0 6px"><label class="field"><span>Cancellation reason</span><select id="reason-preset">${['Heat closure','Illness','Public holiday','Hall unavailable','Instructor unavailable','Other'].map(r=>`<option ${form.reason===r?'selected':''}>${r}</option>`).join('')}</select></label><label class="field"><span>Details</span><input class="input" id="reason" value="${esc(form.reason)}" placeholder="Why did the class not take place?"></label>${scheduledOn(state.config,date).length>1?`<label class="check-label"><input id="cancel-all" type="checkbox">Also cancel the other scheduled class this day</label>`:''}</div>`:`<div class="counter"><input class="headcount" id="headcount" type="number" inputmode="numeric" min="0" max="999" value="${form.unknown?'':esc(form.count)}" placeholder="?" ${form.unknown?'disabled':''} aria-label="Headcount"><div class="counter-label">${form.unknown?'Count unknown':'People in the room'}</div></div><div class="steppers"><button class="stepper" data-adjust="-1" aria-label="Decrease headcount" ${form.unknown?'disabled':''}>${icon('minus')}</button><button class="stepper plus" data-adjust="1" aria-label="Increase headcount" ${form.unknown?'disabled':''}>${icon('plus')}</button></div><label class="check-label"><input id="unknown-count" type="checkbox" ${form.unknown?'checked':''}>Taught, but I don't remember the count</label>${form.status==='substituted'?`<label class="field"><span>Substitute instructor</span><input class="input" id="substitute-name" value="${esc(form.substituteName)}" autocomplete="off"></label>`:''}`}
  <details><summary>Session notes &amp; time</summary><label class="field"><span>Session time</span><input type="time" id="session-time" value="${esc(form.time)}"></label><label class="field"><span>Notes</span><textarea id="session-notes" placeholder="Anything worth remembering?">${esc(form.notes)}</textarea></label></details><div id="form-error" class="form-error" role="alert"></div><div class="save-row"><small id="draft-state">${dirty?'Draft saved on this device':matching.length?'Record already exists':'Ready when you are'}</small><button class="button primary" id="save-session" ${saveBusy?'disabled':''}>${icon('check')}${matching.length?'Save changes':'Save session'}</button></div>`;
}
function periodOptions(value,all=false){return `${all?'<option value="all">All periods &amp; history</option>':''}${state.config.periods.map(p=>`<option value="${esc(p.id)}" ${p.id===value?'selected':''}>${esc(p.name)}</option>`).join('')}`;}
function courseOptions(value,all=true){const cs=new Map(state.config.periods.flatMap(p=>p.courses).map(c=>[c.id,c]));for(const r of state.records)if(!cs.has(r.courseId))cs.set(r.courseId,courseFor(state.config,r.courseId,r.date));return `${all?'<option value="all">All courses</option>':''}${[...cs.values()].map(c=>`<option value="${esc(c.id)}" ${value===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}`;}
function history(){
  const groups=groupRecords(state.records),p=state.config.periods.find(p=>p.id===filterPeriod);
  const records=state.records.filter(r=>!r.deletedAt&&(filterCourse==='all'||r.courseId===filterCourse)&&(!p||r.date>=p.start&&r.date<=p.end)&&(!search||`${r.date} ${r.notes||''} ${r.reason||''} ${courseFor(state.config,r.courseId,r.date).name}`.toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date)||String(a.time).localeCompare(String(b.time)));
  return heading('THE LOGBOOK','Session history',`${records.length} records`, `<button class="button primary" data-backfill>${icon('calendar-plus')}Backfill a class</button>`)+`<div class="toolbar"><div class="actions"><select id="history-period" aria-label="Filter period">${periodOptions(filterPeriod,true)}</select><select id="history-course" aria-label="Filter course">${courseOptions(filterCourse)}</select></div><div class="actions"><input class="input" id="history-search" type="search" aria-label="Search records" placeholder="Search date, course, notes" value="${esc(search)}"></div></div><div class="export-menu"><button class="button ghost compact" data-export="sessions-csv">${icon('download')}CSV</button><button class="button ghost compact" data-export="json">${icon('download')}Full JSON backup</button></div>${records.length?`<div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>Class date</th><th>Course</th><th>Outcome</th><th>Count</th><th>Entered</th><th></th></tr></thead><tbody>${records.map(r=>`<tr><td>${esc(dateLabel(r.date,{year:'numeric'}))}<small>${weekLabel(r.date)} / ${esc(r.time)}</small></td><td><strong>${esc(courseFor(state.config,r.courseId,r.date).name)}</strong>${r.notes?`<small>${esc(r.notes)}</small>`:''}</td><td>${tag(r,(groups.get(sessionKey(r.courseId,r.date))||[]).length>1)}${r.reason?`<small>${esc(r.reason)}</small>`:''}</td><td>${r.count===null?'Unknown':r.status==='cancelled'?'--':esc(r.count)}</td><td>${esc(r.createdAt?dateLabel(r.createdAt.slice(0,10)):'Legacy record')}<small>Revision ${r.revision||1}</small></td><td><div class="actions"><button class="icon-button" data-edit="${esc(r.id)}" title="Edit record" aria-label="Edit record">${icon('pencil')}</button><button class="icon-button" data-audit="${esc(r.id)}" title="Change history" aria-label="Change history">${icon('list-tree')}</button><button class="icon-button" data-archive="${esc(r.id)}" title="Archive record" aria-label="Archive record">${icon('archive')}</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty" style="margin-top:20px">No matching sessions.</div>'}<div class="section-block"><button class="button ghost compact" data-show-archived>${icon('archive-restore')}Archived records</button></div>`;
}
function periodReview(){
  const p=activePeriod();if(!p)return heading('ADMINISTRATION','Period review')+'<button class="button primary" data-view="settings">Add a period</button>';
  periodId=p.id;const rows=billingReview(state.config,state.records,p.id),billable=rows.filter(r=>r.billable),issues=rows.filter(r=>r.review&&!['Upcoming','Holiday'].includes(r.review)),amount=billable.reduce((sum,r)=>sum+(r.amount||0),0),cancelled=rows.filter(r=>r.status==='cancelled');
  return heading('THE ADMIN CORNER','Period review',`${esc(dateLabel(p.start,{year:'numeric'}))} - ${esc(dateLabel(p.end,{year:'numeric'}))}`,`<select id="review-period" class="period-select" aria-label="Billing period">${periodOptions(p.id)}</select>`)+`<div class="metrics"><div class="metric"><small>Confirmed taught</small><div class="value">${billable.length}</div></div><div class="metric"><small>Recorded value</small><div class="value">${euro(amount)}</div></div><div class="metric"><small>Needs review</small><div class="value">${issues.length}</div></div><div class="metric"><small>Cancelled</small><div class="value">${cancelled.length}</div></div></div>${issues.length?'<div class="notice"><span>Resolve highlighted dates before preparing the timesheet.</span></div>':''}<div class="toolbar"><h2>Class by class</h2><div class="export-menu"><button class="button ghost compact" data-export="review-json">${icon('download')}Billing JSON</button><button class="button ghost compact" data-export="review-csv">${icon('download')}Review CSV</button></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Course</th><th>Outcome</th><th>Count</th><th>Review</th><th class="amount">Value</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(dateLabel(r.date,{weekday:'short'}))}<small>${weekLabel(r.date)} / ${esc(r.start)}</small></td><td>${esc(r.name)}</td><td>${tag(r.record,r.records.length>1)}</td><td>${r.record?r.record.count??'Unknown':'--'}</td><td><span class="review-text">${esc(r.review||r.record?.reason||'Confirmed')}</span></td><td class="amount">${r.amount===null?'--':euro(r.amount)}</td><td><button class="icon-button" data-open="${esc(r.courseId)}|${r.date}" title="Open session" aria-label="Open ${esc(r.name)} ${r.date}">${icon('arrow-up-right')}</button></td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:18px">Recorded value uses each course's configured EUR/unit and teaching units. Substitute sessions, duplicate records, holidays and unscheduled sessions require review.</p>`;
}
function insights(){
  const p=activePeriod();if(!p)return heading('THE BIG PICTURE','Training insights')+'<div class="empty">Add a billing period to see its activity.</div>';
  periodId=p.id;const rows=billingReview(state.config,state.records,p.id),taught=rows.filter(r=>r.record&&r.status==='taught'),counts=taught.filter(r=>r.record.count!==null),total=counts.reduce((n,r)=>n+r.record.count,0),avg=counts.length?Math.round(total/counts.length):0,peak=Math.max(0,...counts.map(r=>r.record.count));
  return heading('THE BIG PICTURE','Training insights',esc(p.name),`<select id="review-period" class="period-select" aria-label="Insights period">${periodOptions(p.id)}</select>`)+`<div class="metrics"><div class="metric"><small>Taught sessions</small><div class="value">${taught.length}</div></div><div class="metric"><small>Average headcount</small><div class="value">${avg}</div></div><div class="metric"><small>Peak headcount</small><div class="value">${peak}</div></div><div class="metric"><small>Total class visits</small><div class="value">${total}</div></div></div><div class="stat-list">${p.courses.map(c=>{const sessions=counts.filter(r=>r.courseId===c.id),mean=sessions.length?Math.round(sessions.reduce((n,r)=>n+r.record.count,0)/sessions.length):0,max=Math.max(1,...sessions.map(r=>r.record.count));return `<section class="stat-course"><h3>${esc(c.name)}</h3><div class="bar-caption"><span>${days[c.day]} / ${esc(c.start)}</span><strong>${mean} average</strong></div><div class="spark" role="img" aria-label="${esc(c.name)} headcounts by class date">${sessions.length?sessions.map(r=>`<div class="spark-bar" style="height:${Math.max(2,r.record.count/max*85)}%" title="${r.date}: ${r.record.count}"><span>${r.record.count}</span></div>`).join(''):'<span class="muted" style="margin-bottom:14px;font-size:13px">No recorded headcounts yet</span>'}</div><small>${sessions.length} counted sessions / ${taught.filter(r=>r.courseId===c.id&&r.record.count===null).length} unknown counts</small></section>`;}).join('')}</div>`;
}
function settings(){
  if(!settingsDraft)settingsDraft=structuredClone(state.config);
  let p=settingsDraft.periods.find(p=>p.id===periodId)||settingsDraft.periods.at(-1);if(!p)return '';
  periodId=p.id;
  return heading('SET THE RHYTHM','Courses &amp; periods','Individual dates and rates for every period.')+`<div class="settings-form">${state.configLocal?'<div class="notice"><span>Course settings are saved on this device. Cloud settings access is unavailable.</span></div>':''}<div class="settings-heading"><select id="settings-period" class="period-select" aria-label="Edit period">${settingsDraft.periods.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><button class="button ghost compact" data-new-period>${icon('calendar-plus')}New period</button></div><form id="settings-form"><div class="field-grid"><label class="field span-2"><span>Period name</span><input class="input" name="period-name" value="${esc(p.name)}" required></label><label class="field"><span>Period starts</span><input type="date" name="period-start" value="${p.start}" required></label><label class="field"><span>Period ends</span><input type="date" name="period-end" value="${p.end}" required></label></div><div class="section-block"><div class="settings-heading"><h2>Real teaching slots</h2><button type="button" class="button compact ghost" data-new-course>${icon('plus')}Add course</button></div>${p.courses.map((c,index)=>`<section class="course-settings" data-course-index="${index}"><div class="course-settings-header"><h3>${esc(c.name)}</h3><button type="button" class="icon-button" data-remove-course="${index}" title="Remove course from this period" aria-label="Remove course from this period">${icon('x')}</button></div><div class="course-settings-grid"><label class="field wide"><span>Course name</span><input class="input" data-prop="name" value="${esc(c.name)}" required></label><label class="field"><span>Weekday</span><select data-prop="day">${days.map((d,i)=>`<option value="${i}" ${c.day===i?'selected':''}>${d}</option>`).join('')}</select></label><label class="field"><span>Stable slot ID</span><input class="input" value="${esc(c.id)}" disabled></label><label class="field"><span>Starts at</span><input type="time" data-prop="start" value="${esc(c.start)}" required></label><label class="field"><span>Ends at</span><input type="time" data-prop="end" value="${esc(c.end)}" required></label><label class="field"><span>EUR per teaching unit</span><input class="input" type="number" min="0" step="0.01" data-prop="rate" value="${c.rate??''}"></label><label class="field"><span>Teaching units / class</span><input class="input" type="number" min="0.01" step="0.01" data-prop="units" value="${c.units??''}"></label><label class="field"><span>Course starts (optional)</span><input type="date" data-prop="from" value="${c.from||''}"></label><label class="field"><span>Course ends (optional)</span><input type="date" data-prop="until" value="${c.until||''}"></label><label class="field wide"><span>HSZ listing numbers (comma separated)</span><input class="input" data-prop="listings" value="${esc((c.listings||[]).join(', '))}"></label><label class="field wide"><span>Location</span><input class="input" data-prop="location" value="${esc(c.location||'')}"></label></div></section>`).join('')}</div><div id="settings-error" class="form-error" role="alert"></div><div class="save-row"><small>Changes apply to this period.</small><button class="button primary" type="submit">${icon('check')}Save period</button></div></form><section class="section-block"><h2>Data &amp; recovery</h2><div class="actions"><button class="button ghost" data-export="json">${icon('download')}Full backup</button><button class="button ghost" data-export="config">${icon('download')}Course settings</button><button class="button ghost" data-show-archived>${icon('archive-restore')}Archived records</button></div></section></div>`;
}
function collectSettings(){
  const el=$('#settings-form');if(!el)return;
  const p=settingsDraft.periods.find(p=>p.id===periodId);p.name=el.elements['period-name'].value.trim();p.start=el.elements['period-start'].value;p.end=el.elements['period-end'].value;
  el.querySelectorAll('[data-course-index]').forEach(section=>{const c=p.courses[+section.dataset.courseIndex];section.querySelectorAll('[data-prop]').forEach(input=>{const prop=input.dataset.prop,value=input.value;c[prop]=prop==='day'?+value:['rate','units'].includes(prop)?value===''?null:+value:prop==='listings'?value.split(',').map(s=>s.trim()).filter(Boolean):value;});});
}
async function saveSession(){
  if(saveBusy||!form)return;
  const status=form.status,matching=groupRecords(state.records).get(sessionKey(selectedId,date))||[],existing=matching.length===1?matching[0]:null,record={...form,id:existing?.id||form.id,date,courseId:selectedId,status,count:status==='cancelled'?0:form.unknown?null:form.count===''?NaN:Number(form.count),cancelled:status==='cancelled',reason:status==='cancelled'?form.reason:'',substituteName:status==='substituted'?form.substituteName:'',schemaVersion:SCHEMA_VERSION,periodId:periodFor(state.config,date)?.id||null};
  delete record.unknown;
  const error=validateSession(record);if(error){$('#form-error').textContent=error;return;}
  if(!state.ready){$('#form-error').textContent='Wait for the initial connection, or reconnect to load existing records.';return;}
  if((groupRecords(state.records).get(sessionKey(selectedId,date))||[]).length>1){$('#form-error').textContent='Review duplicate records first.';return;}
  const others=$('#cancel-all')?.checked?scheduledOn(state.config,date).filter(c=>c.id!==selectedId):[];
  const previous=state.records.find(r=>r.id===record.id);
  saveBusy=true;$('#save-session').disabled=true;
  try{
    const result=await store.save(record,form.revision||null);
    for(const c of others){const matches=groupRecords(state.records).get(sessionKey(c.id,date))||[];if(matches.length>1){toast('Other class has duplicates: review separately');continue;}const r=matches[0];await store.save({id:r?.id||sessionKey(c.id,date),courseId:c.id,date,time:c.start,status:'cancelled',cancelled:true,count:0,reason:record.reason,notes:'',substituteName:'',periodId:record.periodId,schemaVersion:SCHEMA_VERSION},r?.revision||null);}
    drafts.remove(sessionKey(selectedId,date));drafts.remove('active');dirty=false;form=null;ensureSelection();toast(result.synced?'Session saved':'Saved on this device; sync pending');
  }catch(e){toast('Save failed: '+e.message);}finally{saveBusy=false;render();}
}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportData(kind){
  const now=new Date().toISOString(),p=activePeriod(),rows=p?billingReview(state.config,state.records,p.id):[];
  if(kind==='json')return download(`arete-boxing-backup-${localDate()}.json`,JSON.stringify({schemaVersion:SCHEMA_VERSION,exportedAt:now,timeZone:'Europe/Berlin',config:state.config,records:state.records,pendingWrites:state.queue},null,2),'application/json');
  if(kind==='config')return download('arete-course-settings.json',JSON.stringify(state.config,null,2),'application/json');
  if(kind==='review-json')return download(`billing-review-${p.id}.json`,JSON.stringify({schemaVersion:SCHEMA_VERSION,exportedAt:now,period:p,rows:rows.map(r=>({...r,calendarWeek:calendarWeek(r.date)})),unresolved:rows.filter(r=>r.review&&!['Upcoming','Holiday'].includes(r.review)).length},null,2),'application/json');
  if(kind==='review-csv')return download(`billing-review-${p.id}.csv`,csv([['Period','Date','Calendar week','Week year','Course ID','Course','HSZ listings','Status','Count','Reason','Review','Billable','EUR estimate'],...rows.map(r=>[p.name,r.date,calendarWeek(r.date).week,calendarWeek(r.date).year,r.courseId,r.name,(r.listings||[]).join(';'),r.status,r.record?.count,r.record?.reason,r.review,r.billable?'Yes':'No',r.amount])]),'text/csv;charset=utf-8');
  download(`arete-sessions-${localDate()}.csv`,csv([['Session ID','Date','Calendar week','Week year','Time','Course ID','Course','Period ID','Status','Count','Reason','Substitute','Notes','Created at','Updated at','Revision'],...state.records.filter(r=>!r.deletedAt).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[r.id,r.date,calendarWeek(r.date).week,calendarWeek(r.date).year,r.time,r.courseId,courseFor(state.config,r.courseId,r.date).name,r.periodId||periodFor(state.config,r.date)?.id,r.status,r.count,r.reason,r.substituteName,r.notes,r.createdAt,r.updatedAt,r.revision])]),'text/csv;charset=utf-8');
}
function modal(content){$('#modal').innerHTML=content;$('#modal').showModal();icons();}
function duplicateRows(records){return records.map(r=>`<div class="duplicate-item"><div><strong>${r.status==='cancelled'?'Cancelled':r.count??'Unknown'} ${r.status==='cancelled'?'':'people'}</strong><small>${esc(r.date)} / ${esc(r.time)} / ${esc(r.reason||'No reason')}<br>${esc(r.id)}</small></div><button class="button compact ghost" data-archive="${esc(r.id)}">${icon('archive')}Archive</button></div>`).join('');}
function showDuplicates(){const groups=[...groupRecords(state.records).values()].filter(g=>g.length>1);modal(`<h2>Duplicate session records</h2><p>Keep the correct record and archive the extra entries. Archived records remain recoverable.</p>${groups.map(g=>`<h3>${esc(dateLabel(g[0].date,{year:'numeric'}))} / ${esc(courseFor(state.config,g[0].courseId,g[0].date).name)}</h3>${duplicateRows(g)}`).join('')}<div class="dialog-actions"><button class="button primary" data-close>Done</button></div>`);}
async function archive(id){const r=state.records.find(r=>r.id===id);if(!r)return;await store.save({...r,deletedAt:new Date().toISOString()},r.revision||1);if(form?.id===id){form=null;dirty=false;}$('#modal').close();render();toast('Record archived',async()=>{const current=state.records.find(x=>x.id===id);await store.save({...current,deletedAt:null},current.revision);});}
function showArchived(){const rs=state.records.filter(r=>r.deletedAt);modal(`<h2>Archived records</h2>${rs.length?rs.map(r=>`<div class="duplicate-item"><div>${esc(dateLabel(r.date,{year:'numeric'}))}<small>${esc(courseFor(state.config,r.courseId,r.date).name)} / ${r.count??'Unknown'}</small></div><button class="button compact ghost" data-restore="${esc(r.id)}">${icon('archive-restore')}Restore</button></div>`).join(''):'<p>No archived records.</p>'}<div class="dialog-actions"><button class="button" data-close>Close</button></div>`);}
function backfill(){modal(`<h2>Backfill a class</h2><form id="backfill-form"><label class="field"><span>Class date</span><input type="date" name="date" value="${shiftDate(localDate(),-1)}" max="${localDate()}" required></label><label class="field"><span>Course</span><select name="course">${courseOptions(selectedId||'c1',false)}</select></label><div class="dialog-actions"><button type="button" class="button ghost" data-close>Cancel</button><button class="button primary" type="submit">Open class ${icon('arrow-right')}</button></div></form>`);}

document.addEventListener('click',async e=>{
  const target=e.target.closest('button');if(!target)return;
  try{
    if(target.dataset.view)return navigate(target.dataset.view);
    if(target.hasAttribute('data-class-people')){peopleView.openCourse(selectedId,date);return navigate('people');}
    if(target.hasAttribute('data-close'))return $('#modal').close();
    if(target.dataset.course){choose(target.dataset.course);if(innerWidth<=760)requestAnimationFrame(()=>$('.counter-surface').scrollIntoView({behavior:'smooth',block:'start'}));return;}
    if(target.dataset.day){const next=shiftDate(date,+target.dataset.day);form=null;selectedId='';date=next;showAll=false;return render();}
    if(target.hasAttribute('data-today')){date=localDate();form=null;selectedId='';showAll=false;return render();}
    if(target.hasAttribute('data-all-courses')){showAll=!showAll;return render();}
    if(target.dataset.adjust){form.count=Math.min(999,Math.max(0,Number(form.count||0)+Number(target.dataset.adjust)));$('#headcount').value=form.count;draft();return;}
    if(target.dataset.outcome){form.status=target.dataset.outcome;if(form.status==='cancelled'&&!form.reason)form.reason=nrwHoliday(date)||'';draft();return render();}
    if(target.id==='save-session')return await saveSession();
    if(target.id==='retry-sync'){await store.connect();await store.flush();return;}
    if(target.dataset.export)return exportData(target.dataset.export);
    if(target.hasAttribute('data-backfill'))return backfill();
    if(target.hasAttribute('data-open-missing')){const s=missingSessions(state.config,state.records)[0];view='desk';location.hash='desk';return choose(s.id,s.date);}
    if(target.dataset.open){const [id,d]=target.dataset.open.split('|');view='desk';location.hash='desk';return choose(id,d);}
    if(target.dataset.edit){const r=state.records.find(r=>r.id===target.dataset.edit);view='desk';location.hash='desk';return choose(r.courseId,r.date);}
    if(target.hasAttribute('data-duplicates'))return showDuplicates();
    if(target.dataset.archive){const r=state.records.find(r=>r.id===target.dataset.archive);modal(`<h2>Archive this record?</h2><p>${esc(courseFor(state.config,r.courseId,r.date).name)} / ${esc(dateLabel(r.date,{year:'numeric'}))} / ${r.count??'Unknown'} people. You can restore it from History.</p><div class="dialog-actions"><button class="button ghost" data-close>Keep record</button><button class="button danger" data-confirm-archive="${esc(r.id)}">${icon('archive')}Archive</button></div>`);return;}
    if(target.dataset.confirmArchive)return await archive(target.dataset.confirmArchive);
    if(target.hasAttribute('data-show-archived'))return showArchived();
    if(target.dataset.restore){const r=state.records.find(r=>r.id===target.dataset.restore);await store.save({...r,deletedAt:null},r.revision||1);showArchived();return;}
    if(target.dataset.audit){const r=state.records.find(r=>r.id===target.dataset.audit);modal(`<h2>Change history</h2><p>${esc(courseFor(state.config,r.courseId,r.date).name)} / ${esc(r.date)}<br>Created: ${esc(r.createdAt||'Legacy record')}<br>Last updated: ${esc(r.updatedAt||'Not recorded')}</p>${(r.history||[]).slice().reverse().map(h=>`<div class="duplicate-item"><div>${esc(h.at)}<small>Previous: ${esc(h.previous.status)} / ${h.previous.count??'Unknown'} people / ${esc(h.previous.reason)}</small></div></div>`).join('')||'<p>No earlier revisions recorded.</p>'}<div class="dialog-actions"><button class="button" data-close>Close</button></div>`);return;}
    if(target.dataset.server){await store.discardConflict(target.dataset.server);form=null;dirty=false;return render();}
    if(target.hasAttribute('data-new-period')){collectSettings();modal(`<h2>Add a billing period</h2><form id="new-period-form"><label class="field"><span>Name</span><input class="input" name="name" placeholder="Summer 2027 / Period 1" required></label><div class="field-grid"><label class="field"><span>Starts</span><input type="date" name="start" required></label><label class="field"><span>Ends</span><input type="date" name="end" required></label></div><label class="check-label"><input name="copy" type="checkbox" checked>Copy the selected period's courses</label><div class="form-error" id="new-period-error" role="alert"></div><div class="dialog-actions"><button class="button ghost" type="button" data-close>Cancel</button><button class="button primary" type="submit">Add period</button></div></form>`);return;}
    if(target.hasAttribute('data-new-course')){collectSettings();settingsDraft.periods.find(p=>p.id===periodId).courses.push({id:'slot-'+crypto.randomUUID().slice(0,8),name:'New course',day:1,start:'20:00',end:'21:25',rate:null,units:1.5,listings:[],location:''});return render();}
    if(target.dataset.removeCourse!==undefined){collectSettings();settingsDraft.periods.find(p=>p.id===periodId).courses.splice(+target.dataset.removeCourse,1);return render();}
  }catch(error){toast(error.message);}
});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='headcount'){form.count=el.value===''?'':Number(el.value);draft();}
  const props={'session-notes':'notes','reason':'reason','substitute-name':'substituteName','session-time':'time'};
  if(props[el.id]&&form){form[props[el.id]]=el.value;draft();}
  if(el.id==='history-search'){const pos=el.selectionStart;search=el.value;render();$('#history-search').focus();$('#history-search').setSelectionRange(pos,pos);}
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='session-date'&&validDate(el.value)){date=el.value;form=null;selectedId='';showAll=false;render();}
  if(el.id==='unknown-count'){form.unknown=el.checked;draft();render();}
  if(el.id==='reason-preset'){form.reason=el.value==='Other'?'':el.value;draft();render();$('#reason').focus();}
  if(el.id==='history-period'){filterPeriod=el.value;render();}
  if(el.id==='history-course'){filterCourse=el.value;render();}
  if(el.id==='review-period'){periodId=el.value;render();}
  if(el.id==='settings-period'){collectSettings();periodId=el.value;render();}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const el=e.target;
  try{
    if(el.id==='backfill-form'){const d=el.elements.date.value,id=el.elements.course.value;if(!validDate(d))return;$('#modal').close();view='desk';location.hash='desk';showAll=true;choose(id,d);}
    if(el.id==='settings-form'){
      collectSettings();const error=validateConfig(settingsDraft);if(error){$('#settings-error').textContent=error;return;}
      const button=el.querySelector('[type=submit]');button.disabled=true;
      try{const result=await store.saveConfig(structuredClone(settingsDraft));form=null;toast(result.local?'Period saved on this device':'Period saved');render();}catch(err){$('#settings-error').textContent=err.message;button.disabled=false;}
    }
    if(el.id==='new-period-form'){
      const values=new FormData(el),start=values.get('start'),end=values.get('end'),source=settingsDraft.periods.find(p=>p.id===periodId);
      if(!validDate(start)||!validDate(end)||end<start){$('#new-period-error').textContent='Check the start and end dates.';return;}
      if(settingsDraft.periods.some(p=>start<=p.end&&end>=p.start)){$('#new-period-error').textContent='This overlaps an existing billing period.';return;}
      const courses=values.get('copy')?structuredClone(source.courses).map(c=>{delete c.from;delete c.until;return c;}):[{id:'c1',name:'Boxing Level 1',day:1,start:'20:00',end:'21:25',rate:null,units:1.5,listings:[],location:''}];
      const p={id:'period-'+crypto.randomUUID().slice(0,8),name:String(values.get('name')).trim(),start,end,courses};settingsDraft.periods.push(p);periodId=p.id;$('#modal').close();render();
    }
  }catch(error){toast(error.message);}
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1)||'desk';if(next!==view){view=next;settingsDraft=null;render();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){renderSync();if(state.connected)store.flush();}});
render();store.connect();
if('serviceWorker' in navigator&&!state.demo)navigator.serviceWorker.register('./sw.js').catch(()=>{});
