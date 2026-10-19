import { defaultConfig, normalizeRecord, sessionKey, validateConfig } from './core.mjs';

const demo = new URLSearchParams(location.search).has('demo');
const prefix = demo ? 'arete.demo.v2.' : 'arete.boxing.v2.';
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(prefix+key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(prefix+key, JSON.stringify(value));
export const drafts = { get:key=>read('draft.'+key,null), set:(key,value)=>write('draft.'+key,value), remove:key=>localStorage.removeItem(prefix+'draft.'+key) };
const actor = read('actor', crypto.randomUUID()); write('actor', actor);

export function createStore(onChange) {
  const state = { records:read('records',[]), config:read('config',structuredClone(defaultConfig)), queue:read('queue',[]), connected:false, ready:false, demo, error:'', configLocal:false };
  let api=null, db=null, flushing=false, initializing=false, stops=[];
  const emit=()=>onChange(state);
  const persist=()=>{ write('records',state.records); write('queue',state.queue); write('config',state.config); emit(); };
  function overlay(remote) {
    const map=new Map(remote.map(r=>[r.id,r]));
    for(const q of state.queue) map.set(q.record.id,{...q.record,_pending:true});
    state.records=[...map.values()]; write('records',state.records);
  }
  async function connect() {
    if (initializing) return; initializing=true;
    if(demo){state.ready=true;state.connected=true;initializing=false;persist();return;}
    try {
      api=await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js');
      const {initializeApp,getApps}=await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js');
      db=api.getFirestore(getApps()[0]||initializeApp({apiKey:'AIzaSyD5m5QOdKK6Vy5Sr0HWciuviy0rAlvsik8',authDomain:'boxing-tracker-8fab1.firebaseapp.com',projectId:'boxing-tracker-8fab1',storageBucket:'boxing-tracker-8fab1.firebasestorage.app',messagingSenderId:'285906789422',appId:'1:285906789422:web:8a2b773c865bea8e94ebbf'}));
      stops.forEach(fn=>fn()); stops=[];
      stops.push(api.onSnapshot(api.collection(db,'sessions'),{includeMetadataChanges:true},snap=>{
        overlay(snap.docs.map(d=>normalizeRecord({id:d.id,...d.data()})));
        state.ready=true;state.connected=!snap.metadata.fromCache && navigator.onLine;state.error='';emit();
        if(state.connected)flush();
      },error=>{state.ready=true;state.connected=false;state.error=error.code||error.message;emit();}));
      stops.push(api.onSnapshot(api.doc(db,'settings','arete-boxing-v2'),snap=>{
        if(snap.exists()&&!validateConfig(snap.data().config)){state.config=snap.data().config;write('config',state.config);emit();}
      },()=>{state.configLocal=true;emit();}));
    } catch(error) {state.ready=true;state.connected=false;state.error=error.message;emit();}
    finally {initializing=false;}
  }
  async function save(record, expectedRevision=null) {
    const existing=state.records.find(r=>r.id===record.id);
    const queued=state.queue.find(q=>q.record.id===record.id);
    const now=new Date().toISOString();
    const history=[...(existing?.history||[])];
    if(existing)history.push({at:now,actor,previous:{date:existing.date,courseId:existing.courseId,count:existing.count,status:existing.status,reason:existing.reason||'',substituteName:existing.substituteName||'',notes:existing.notes||'',deletedAt:existing.deletedAt||null}});
    const next={...existing,...record,revision:(existing?.revision||0)+1,createdAt:existing?.createdAt||now,updatedAt:now,enteredBy:actor,history};
    next.cancelled=!!next.deletedAt||next.status==='cancelled';
    delete next._pending;
    const entry={record:next,expectedRevision:queued?queued.expectedRevision:expectedRevision,error:''};
    state.queue=state.queue.filter(q=>q.record.id!==record.id);state.queue.push(entry);
    overlay(state.records);persist();
    if(demo){state.queue=[];next._pending=false;state.records=state.records.map(r=>r.id===next.id?next:r);persist();return {synced:true};}
    if(state.connected)await flush();
    return {synced:!state.queue.some(q=>q.record.id===record.id)};
  }
  async function flush() {
    if(flushing||!api||!db||!navigator.onLine)return;
    flushing=true;
    try {
      for(const entry of [...state.queue]) {
        if(entry.error==='conflict')continue;
        try {
          const ref=api.doc(db,'sessions',entry.record.id);
          await api.runTransaction(db,async transaction=>{
            const snap=await transaction.get(ref),remote=snap.exists()?snap.data():null;
            // An interrupted response may have committed this exact queued revision already.
            if(remote?.updatedAt===entry.record.updatedAt&&remote?.enteredBy===actor)return;
            if(entry.expectedRevision===null&&remote || entry.expectedRevision!==null&&(!remote||(remote.revision||1)!==entry.expectedRevision))throw new Error('revision-conflict');
            const data={...entry.record,ts:remote?.ts||api.serverTimestamp(),updatedAtServer:api.serverTimestamp()};
            transaction.set(ref,data,{merge:true});
          });
          const current=state.queue.find(q=>q.record.id===entry.record.id);
          if(current===entry)state.queue=state.queue.filter(q=>q!==entry);
          else if(current)current.expectedRevision=entry.record.revision;
          const local=state.records.find(r=>r.id===entry.record.id);
          if(local&&local.updatedAt===entry.record.updatedAt)delete local._pending;
          state.error='';persist();
        }catch(error){
          entry.error=error.message==='revision-conflict'?'conflict':error.code||error.message;
          state.error=entry.error;persist();
          if(entry.error!=='conflict'){state.connected=false;break;}
        }
      }
    }finally{flushing=false;if(state.connected&&state.queue.some(q=>!q.error))queueMicrotask(flush);}
  }
  async function discardConflict(id) {
    if(!api||!db)throw new Error('Connect before loading the server version.');
    const snap=await api.getDocFromServer(api.doc(db,'sessions',id));
    state.queue=state.queue.filter(q=>q.record.id!==id);
    state.records=state.records.filter(r=>r.id!==id);
    if(snap.exists())state.records.push(normalizeRecord({id:snap.id,...snap.data()}));
    state.error='';persist();
  }
  async function saveConfig(config) {
    if(!demo){
      if(!api||!state.connected)throw new Error('Connect to save shared course settings.');
      try {await api.setDoc(api.doc(db,'settings','arete-boxing-v2'),{config,updatedAt:api.serverTimestamp(),enteredBy:actor});state.configLocal=false;}
      catch(error){if(error.code==='permission-denied'){state.configLocal=true;}else throw error;}
    }
    state.config=config;persist();return {local:state.configLocal};
  }
  window.addEventListener('offline',()=>{state.connected=false;emit();});
  window.addEventListener('online',()=>{state.connected=true;connect();});
  window.addEventListener('storage',e=>{if(e.key?.startsWith(prefix)){state.queue=read('queue',[]);state.records=read('records',[]);state.config=read('config',state.config);emit();}});
  return {state,connect,save,saveConfig,flush,discardConflict,demo,sessionKey};
}
