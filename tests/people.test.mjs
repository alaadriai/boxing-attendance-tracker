import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRegistry,registryPeople,personHistory,personKey,displayName} from '../people.mjs';
const source={id:'1',courseNumber:'33331117',courseName:'Boxing Level 1',periodStart:'2026-10-19',periodEnd:'2026-12-21',weekday:1,startTime:'20:00',endTime:'21:25',snapshotAt:'2026-10-17T08:00:00Z',pdfName:'example.pdf',names:['Taylor, Alex','Old, Person']};
const registry={kind:'arete-registration-registry',schemaVersion:1,sources:[source,{...source,id:'2',snapshotAt:'2026-10-18T08:00:00Z',names:['Taylor, Alex','Patel, Rosa']},{...source,id:'3',courseNumber:'33331118',courseName:'Boxing Plus',names:['Taylor, Alex','Lee, Jordan']},{...source,id:'4',courseNumber:'33332117',periodStart:'2026-07-13',periodEnd:'2026-10-05',names:['Taylor, Alex']}]};
const period={start:'2026-10-19',end:'2026-12-22'},course={listings:['33331117','33331118']};
test('private registry validation rejects unrelated or malformed files',()=>{
  assert.equal(validateRegistry(registry),null);
  assert.match(validateRegistry({records:[]}),/registry export/);
  assert.match(validateRegistry({...registry,sources:[{...source,names:['A',{}]}]}),/invalid/);
});
test('latest lists determine current registrations and same-slot listings deduplicate names',()=>{
  const people=registryPeople(registry,period,course);
  assert.equal(people.length,3);
  assert.ok(!people.some(p=>p.name==='Old, Person'));
  assert.equal(people.find(p=>p.name==='Taylor, Alex').sources.length,2);
  assert.equal(registryPeople(registry,{start:'2027-01-01',end:'2027-04-01'},course).length,0);
});
test('registration history retains earlier periods and names seen in earlier snapshots',()=>{
  assert.equal(personHistory(registry,personKey('Taylor, Alex')).length,3);
  assert.equal(personHistory(registry,personKey('Old, Person')).length,1);
  assert.equal(displayName('Taylor, Alex'),'Alex Taylor');
  assert.equal(personKey('Gürsoy, Yusuf'),personKey('Gu"rsoy, Yusuf'));
});
