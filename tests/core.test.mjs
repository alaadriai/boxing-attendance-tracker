import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDate,defaultConfig,detectCourse,scheduledOn,missingSessions,billingReview,validateSession,validateConfig,nrwHoliday,csv,groupRecords,calendarWeek} from '../core.mjs';

test('Berlin class date remains correct after local midnight and at DST boundaries',()=>{
  assert.equal(localDate(new Date('2026-10-18T22:30:00Z')),'2026-10-19');
  assert.equal(localDate(new Date('2026-12-01T23:30:00Z')),'2026-12-02');
  assert.equal(localDate(new Date('2026-10-25T01:30:00Z')),'2026-10-25');
});
test('ISO calendar weeks use the week year at New Year',()=>{
  assert.deepEqual(calendarWeek('2026-10-19'),{year:2026,week:43});
  assert.deepEqual(calendarWeek('2027-01-01'),{year:2026,week:53});
  assert.deepEqual(calendarWeek('2027-01-04'),{year:2027,week:1});
});
test('Monday auto-detection selects Fitness during Fitness, with revised Thursday time',()=>{
  assert.equal(detectCourse(defaultConfig,'2026-10-19',new Date('2026-10-19T19:40:00Z')).id,'c2');
  assert.equal(scheduledOn(defaultConfig,'2026-10-22')[0].start,'20:30');
  assert.equal(scheduledOn(defaultConfig,'2026-12-24').length,0);
});
test('backfilling a taught zero count differs from cancellation and unknown count',()=>{
  for(const count of [0,null,18])assert.equal(validateSession({date:'2026-10-19',status:'taught',count},'2026-10-20'),null);
  assert.match(validateSession({date:'2026-10-19',status:'cancelled',count:0,reason:''},'2026-10-20'),/reason/);
  assert.equal(validateSession({date:'2026-10-22',status:'cancelled',count:0,reason:'Heat closure'},'2026-10-20'),null);
  assert.match(validateSession({date:'2026-10-22',status:'taught',count:18},'2026-10-20'),/future/i);
  assert.match(validateSession({date:'2026-02-30',status:'taught',count:18},'2026-10-20'),/valid/);
  assert.match(validateSession({date:'2026-10-19',status:'taught',count:1.5},'2026-10-20'),/whole/);
});
test('missing classes stop appearing after backfill or cancellation, without needing a count',()=>{
  assert.equal(missingSessions(defaultConfig,[],'2026-10-20').length,2);
  const rs=[{id:'1',date:'2026-10-19',courseId:'c1',count:null,status:'taught'},{id:'2',date:'2026-10-19',courseId:'c2',cancelled:true,count:0}];
  assert.equal(missingSessions(defaultConfig,rs,'2026-10-20').length,0);
});
test('duplicates and archived records cannot inflate billing or attendance totals',()=>{
  const records=[{id:'1',date:'2026-10-19',courseId:'c1',status:'taught',count:10},{id:'2',date:'2026-10-19',courseId:'c1',count:20},{id:'3',date:'2026-10-19',courseId:'c2',status:'taught',count:15,deletedAt:'2026-10-20'}];
  const rows=billingReview(defaultConfig,records,'ws2026-1','2026-10-20');
  assert.equal(rows[0].billable,false);assert.equal(rows[0].review,'Duplicate records');
  assert.equal(groupRecords(records).size,1);
  records[1].deletedAt='2026-10-20';
  assert.equal(billingReview(defaultConfig,records,'ws2026-1')[0].amount,18);
});
test('periods can have different dates, rate changes, and a late replacement course',()=>{
  const config=structuredClone(defaultConfig);
  config.periods.push({id:'summer',name:'Custom summer',start:'2027-04-12',end:'2027-07-08',courses:[{id:'replacement',name:'Replacement',day:1,start:'21:30',end:'22:55',from:'2027-04-26',until:'2027-06-28',rate:18,units:1.5,listings:['123']}]});
  assert.equal(validateConfig(config),null);
  assert.equal(scheduledOn(config,'2027-04-19').length,0);
  assert.equal(scheduledOn(config,'2027-04-26')[0].name,'Replacement');
  const rows=billingReview(config,[{id:'r',date:'2027-04-26',courseId:'replacement',status:'taught',count:20}],'summer','2027-07-09');
  assert.equal(rows[0].amount,27);
  config.periods[1].start='2026-12-01';assert.match(validateConfig(config),/overlap/);
});
test('holidays, substitutes and unscheduled records require explicit review',()=>{
  assert.equal(nrwHoliday('2027-03-29'),'Easter Monday');
  assert.equal(nrwHoliday('2026-06-04'),'Corpus Christi');
  const records=[{id:'1',date:'2026-10-19',courseId:'c1',status:'substituted',count:15,substituteName:'Coach'},{id:'2',date:'2026-10-20',courseId:'c1',status:'taught',count:10}];
  const rows=billingReview(defaultConfig,records,'ws2026-1','2026-10-21');
  assert.equal(rows.find(r=>r.date==='2026-10-19'&&r.courseId==='c1').billable,false);
  assert.match(rows.find(r=>r.date==='2026-10-20').review,/Outside/);
});
test('spreadsheet exports escape formulas and preserve quotes',()=>{
  const output=csv([['=1+1','Hello "coach"',0,null]]);
  assert.match(output,/'=1\+1/);assert.match(output,/Hello ""coach""/);
});
