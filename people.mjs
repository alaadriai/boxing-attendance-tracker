import {validDate,localDate,dateLabel,periodFor} from './core.mjs';
import {sharedRegistry} from './shared-registry.mjs';

export const personKey=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function displayName(name){const clean=String(name).replace(/^\s*-\s*/, '').trim();const parts=clean.split(',');return parts.length===2?`${parts[1].trim()} ${parts[0].trim()}`:clean;}
export function validateRegistry(value){
  if(value?.kind!=='arete-registration-registry'||value.schemaVersion!==1||!Array.isArray(value.sources)||value.sources.length>5000)return 'Choose a registration_people_private.json registry export.';
  let total=0;
  for(const s of value.sources){
    if(!s||typeof s.courseNumber!=='string'||typeof s.courseName!=='string'||!validDate(s.periodStart)||!validDate(s.periodEnd)||s.periodEnd<s.periodStart||!Number.isInteger(s.weekday)||s.weekday<0||s.weekday>6||!Number.isFinite(Date.parse(s.snapshotAt))||!Array.isArray(s.names)||s.names.some(n=>typeof n!=='string'||n.length>250)||s.names.length>3000)return 'The registry contains an invalid course, date, or name list.';
    total+=s.names.length;
  }
  return total>100000?'The registry is too large for this view.':null;
}
const offeringKey=s=>`${s.courseNumber}|${s.periodStart}|${s.periodEnd}|${s.weekday}|${s.startTime}`;
export function latestSources(registry){
  const map=new Map();
  for(const s of registry?.sources||[]){const k=offeringKey(s),previous=map.get(k);if(!previous||s.snapshotAt>=previous.snapshotAt)map.set(k,s);}
  return [...map.values()];
}
export function registryPeople(registry,period=null,course=null){
  const sources=latestSources(registry).filter(s=>(!period||s.periodStart<=period.end&&s.periodEnd>=period.start)&&(!course||(course.listings||[]).includes(s.courseNumber)));
  const people=new Map();
  for(const s of sources)for(const name of s.names){const key=personKey(name);if(!key)continue;if(!people.has(key))people.set(key,{key,name,displayName:displayName(name),sources:[]});people.get(key).sources.push(s);}
  return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
}
export function personHistory(registry,key){
  const sources=(registry?.sources||[]).filter(s=>s.names.some(n=>personKey(n)===key));
  const map=new Map();for(const s of sources){const k=offeringKey(s),previous=map.get(k);if(!previous||s.snapshotAt>previous.snapshotAt)map.set(k,s);}
  return [...map.values()].sort((a,b)=>b.periodStart.localeCompare(a.periodStart)||a.courseNumber.localeCompare(b.courseNumber));
}

export class PeopleView{
  constructor({config,render,modal,toast,esc,icon,demo=false}){
    Object.assign(this,{config,redraw:render,modal,toast,esc,icon});this.periodId='current';this.courseId='all';this.query='';this.mode='all';this.shared=!demo&&!!sharedRegistry.registry;this.registry=this.shared?sharedRegistry.registry:null;this.key=demo?'arete.people.demo.v1':'arete.people.private.v1';
    if(!this.shared)try{const stored=JSON.parse(localStorage.getItem(this.key));if(stored&&!validateRegistry(stored))this.registry=stored;}catch{}
    document.addEventListener('click',async event=>{const button=event.target.closest('[data-refresh-people]');if(!button)return;button.disabled=true;try{this.registry=await sharedRegistry.refresh();this.redraw();this.toast('Shared registration lists refreshed');}catch(error){this.toast(error.message);button.disabled=false;}});
    document.addEventListener('change',async event=>{
      const el=event.target;
      if(el.id==='people-file'&&!this.shared&&el.files[0]){try{const file=el.files[0];if(file.size>12*1024*1024)throw new Error('Use a registry export smaller than 12 MB.');const registry=JSON.parse(await file.text()),error=validateRegistry(registry);if(error)throw new Error(error);localStorage.setItem(this.key,JSON.stringify(registry));this.registry=registry;this.toast('Registration lists imported on this device');this.redraw();}catch(error){this.toast(error.message);}finally{el.value='';}}
      if(el.id==='people-period'){this.periodId=el.value;this.courseId='all';this.redraw();}
      if(el.id==='people-course'){this.courseId=el.value;this.redraw();}
      if(el.id==='people-mode'){this.mode=el.value;this.redraw();}
    });
    document.addEventListener('input',event=>{if(event.target.id==='people-search'){const cursor=event.target.selectionStart;this.query=event.target.value;this.redraw();const input=document.querySelector('#people-search');input.focus();input.setSelectionRange(cursor,cursor);}});
    document.addEventListener('click',event=>{const el=event.target.closest('button');if(!el)return;if(el.dataset.personKey)this.detail(el.dataset.personKey);if(el.hasAttribute('data-clear-people'))this.modal(`<h2>Remove this device's registration lists?</h2><p>The archived PDFs and OneDrive registry will remain available.</p><div class="dialog-actions"><button class="button ghost" data-close>Keep lists</button><button class="button danger" data-confirm-clear-people>Remove local copy</button></div>`);if(el.hasAttribute('data-confirm-clear-people')){localStorage.removeItem(this.key);this.registry=null;document.querySelector('#modal').close();this.redraw();}});
  }
  openCourse(courseId,date){const p=periodFor(this.config(),date);this.periodId=p?.id||'all';this.courseId=p?.courses.some(c=>c.id===courseId)?courseId:'all';this.query='';this.mode='all';}
  period(){return this.periodId==='all'?null:this.config().periods.find(p=>p.id===this.periodId)||periodFor(this.config(),localDate())||this.config().periods.at(-1);}
  render(){
    const {esc,icon}=this,p=this.period(),course=p?.courses.find(c=>c.id===this.courseId),all=registryPeople(this.registry,p),people=registryPeople(this.registry,p,course),query=personKey(this.query);
    const history=new Map(people.map(person=>[person.key,personHistory(this.registry,person.key)]));
    const paired=key=>new Set(all.find(person=>person.key===key)?.sources.map(s=>s.weekday)||[]).size>1;
    const returning=key=>!!p&&history.get(key).some(s=>s.periodEnd<p.start);
    const shown=people.filter(person=>(!query||personKey(person.name).includes(query)||personKey(person.displayName).includes(query))&&(this.mode==='all'||this.mode==='returning'&&returning(person.key)||this.mode==='both'&&paired(person.key)||this.mode==='plus'&&person.sources.some(s=>/plus/i.test(s.courseName))));
    const latest=this.registry?.asOf||this.registry?.sources.map(s=>s.snapshotAt).sort().at(-1);
    const registryAction=this.shared?`<button class="button ghost" data-refresh-people>${icon('refresh-cw')}Refresh lists</button>`:`<label class="button ${this.registry?'ghost':'primary'}" for="people-file">${icon('folder-open')}Import registry</label><input id="people-file" type="file" accept=".json,application/json" hidden>`;
    let html=`<div class="page-heading people-heading"><div><div class="eyebrow">THE PEOPLE IN YOUR CORNER</div><h1>Registered people</h1><p>${latest?'Latest archived snapshot: '+esc(dateLabel(latest.slice(0,10),{year:'numeric'})):'Course registration lists'}</p></div>${registryAction}</div>`;
    if(!this.registry)return html+`<div class="empty">${icon('users-round')}<p>No registration registry loaded on this device.</p><label class="button ghost" for="people-file">${icon('upload')}Choose private registry file</label></div>`;
    html+=`<div class="people-source"><span class="tag taught">${icon(this.shared?'cloud':'hard-drive')}${this.shared?'Shared across devices':'Private on this device'}</span><span>${this.registry.sources.length} archived PDF snapshots</span>${this.shared?'':`<button class="icon-button" data-clear-people title="Remove local registry" aria-label="Remove local registry">${icon('trash-2')}</button>`}</div><div class="toolbar people-filters"><label class="field"><span>Period</span><select id="people-period" aria-label="Registration period"><option value="all" ${!p?'selected':''}>All archived periods</option>${this.config().periods.map(x=>`<option value="${esc(x.id)}" ${p?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>Course</span><select id="people-course" aria-label="Registered course"><option value="all">All courses</option>${(p?.courses||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===this.courseId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Show</span><select id="people-mode" aria-label="People filter">${[['all','Everyone'],['returning','Earlier registrations'],['both','Registered on both days'],['plus','Plus listings']].map(([value,label])=>`<option value="${value}" ${this.mode===value?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="field people-search"><span>Find a person</span><span class="search-input">${icon('search')}<input id="people-search" class="input" type="search" placeholder="First name or surname" value="${esc(this.query)}" autocomplete="off"></span></label><div class="section-label"><span>${esc(course?.name||'Registration archive')}</span><span>${shown.length} ${shown.length===1?'person':'people'}</span></div><div class="people-list">${shown.map(person=>{const listingNumbers=[...new Set(person.sources.map(s=>s.courseNumber))];return `<div class="person-row"><div class="person-identity"><span class="person-avatar tone-${[...person.key].reduce((tone,char)=>(tone+char.charCodeAt(0))%4,0)}" aria-hidden="true">${esc(person.displayName.split(/\s+/).filter(Boolean).map(part=>part[0]).filter((_,index,array)=>index===0||index===array.length-1).join('').toUpperCase())}</span><div class="person-name"><strong>${esc(person.displayName)}</strong><small>${esc(listingNumbers.join(' / '))}</small></div></div><div class="person-tags">${paired(person.key)?'<span class="tag taught">Both days</span>':''}${returning(person.key)?'<span class="tag">Earlier registration</span>':''}${person.sources.some(s=>/plus/i.test(s.courseName))?'<span class="tag pending">Plus</span>':''}</div><button class="icon-button" data-person-key="${esc(person.key)}" title="Registration history" aria-label="Registration history for ${esc(person.displayName)}">${icon('arrow-up-right')}</button></div>`;}).join('')||'<div class="empty">No names match these filters in the imported snapshots.</div>'}</div>`;
    return html;
  }
  detail(key){
    const {esc}=this,history=personHistory(this.registry,key),first=history[0]?.names.find(n=>personKey(n)===key);if(!first)return;
    this.modal(`<h2>${esc(displayName(first))}</h2><p>Archived registrations with this name</p>${history.map(s=>`<div class="person-history"><strong>${esc(s.courseName)}</strong><span>${esc(s.courseNumber)} / ${esc(dateLabel(s.periodStart,{year:'numeric'}))} - ${esc(dateLabel(s.periodEnd,{year:'numeric'}))}</span><small>Snapshot ${esc(dateLabel(s.snapshotAt.slice(0,10),{year:'numeric'}))}<br>${esc(s.pdfName||'Registration PDF')}</small></div>`).join('')}<div class="dialog-actions"><button class="button primary" data-close>Done</button></div>`);
  }
}
