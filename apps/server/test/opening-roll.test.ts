import test from 'node:test';
import assert from 'node:assert/strict';
import { openingRollSchema, worldContentSchema } from '@novel-game/contracts';
import { applyOpeningRollCommand, applyOpeningSet, createOpeningRollSession } from '@novel-game/play-runtime';

const fixture=worldContentSchema.parse({schemaVersion:1,mode:'open',title:'Test',premise:'test',playerRole:'traveler',goal:'survive',worldRules:['rule'],adaptationNotes:'',sourceChapterIds:['c1'],initialLocationId:'home',timeLimit:20,timeoutEnding:'time',locations:[{id:'home',title:'Home',text:'home',origin:'adapted',evidence:[]},{id:'road',title:'Road',text:'road',origin:'adapted',evidence:[]},{id:'inn',title:'Inn',text:'inn',origin:'adapted',evidence:[]}],facts:[{id:'gift',label:'Gift',description:'',kind:'event',initialValue:false,playerKnown:true,origin:'adapted',evidence:[]}],npcs:[],actions:[{id:'a',label:'A',description:'',locationId:'home',availableWhen:[],requires:[],blockedReason:'Unavailable',risk:'',timeCost:1,once:false,effects:[{kind:'move',locationId:'road'}],text:'go',origin:'adapted',evidence:[]},{id:'b',label:'B',description:'',locationId:'home',availableWhen:[],requires:[],blockedReason:'Unavailable',risk:'',timeCost:1,once:false,effects:[{kind:'move',locationId:'inn'}],text:'go',origin:'adapted',evidence:[]},{id:'c',label:'C',description:'',locationId:'road',availableWhen:[],requires:[],blockedReason:'Unavailable',risk:'',timeCost:1,once:false,effects:[{kind:'move',locationId:'home'}],text:'back',origin:'adapted',evidence:[]}],events:[],endings:[{id:'e1',title:'End1',text:'ending',when:[{kind:'time',atLeast:1}]},{id:'e2',title:'End2',text:'ending',when:[{kind:'time',atLeast:2}]}],resources:{power:0},resourceDefs:{power:{label:'Power',min:1,max:10,initial:1}},openingRoll:{enabled:true,mode:'perStat',stats:[{resourceId:'power',min:1,max:10}],rerolls:2,choice:{kind:'pickOf',n:3},keepBest:true,lockAfterStart:true,tags:[{id:'gifted',when:{kind:'atLeast',resourceId:'power',value:9},grant:{facts:['gift']},label:'Gifted',effect:'A door opens.'}]}});

test('K16 seeded roll supports pick, reroll, selection without RNG rewind, confirm and grants',()=>{
  const a=createOpeningRollSession(fixture,42); const b=createOpeningRollSession(fixture,42);
  const rolled=applyOpeningRollCommand(fixture,a,'roll');
  assert.deepEqual(rolled.history,applyOpeningRollCommand(fixture,b,'roll').history);
  assert.equal(rolled.history.length,3); assert.equal(rolled.selectedIndex,null);
  const selected=applyOpeningRollCommand(fixture,rolled,'select',1);
  assert.equal(selected.seedCursor,rolled.seedCursor);
  const rerolled=applyOpeningRollCommand(fixture,selected,'reroll');
  assert.equal(rerolled.history.length,3); assert.equal(rerolled.rerollsLeft,1);
  assert.notDeepEqual(rerolled.history,rolled.history); assert.ok(rerolled.seedCursor>rolled.seedCursor);
  const state={resources:{power:1},facts:{gift:false}};
  const confirmed=applyOpeningRollCommand(fixture,rerolled,'select',1);
  const done=applyOpeningRollCommand(fixture,confirmed,'confirm');
  applyOpeningSet(fixture,state,done);
  assert.equal(done.phase,'play'); assert.equal(state.resources.power,done.history[1]!.values.power);
  assert.equal(state.facts.gift,done.history[1]!.values.power>=9);
});

test('K16 standard setup schema accepts omitted standard and disabled worlds remain disabled',()=>{
  assert.equal(openingRollSchema.parse({enabled:false,stats:[{resourceId:'x',min:1,max:2}]}).enabled,false);
  assert.equal(fixture.openingRoll?.standard,undefined);
});

test('K16 rejects reroll before the first draw and prevents replacing a drawn setup with standard',()=>{
  const session=createOpeningRollSession(fixture,42);
  assert.throws(()=>applyOpeningRollCommand(fixture,session,'reroll'),/先掷出/);
  const withStandard=worldContentSchema.parse({...fixture,openingRoll:{...fixture.openingRoll,standard:{values:{power:5}}}});
  const drawn=applyOpeningRollCommand(withStandard,session,'roll');
  assert.throws(()=>applyOpeningRollCommand(withStandard,drawn,'useStandard'),/已经掷出/);
});
