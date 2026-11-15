'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ChatGPTAcquisitionManager}=require('../../extension/src/platforms/chatgpt/acquisition_manager');
const fixture=require('./fixtures/chatgpt_assets.json');
const manager=new ChatGPTAcquisitionManager();
const conversation=id=>({...structuredClone(fixture.raw),id});

test('official import rejects unrelated JSON, absent identity and invalid message mappings',()=>{
 for(const raw of [{hello:'world'},[],{id:'x'}, {id:'x',mapping:[]}, {id:'x',mapping:{root:null}}, {id:'   ',mapping:{}}, {id:17,mapping:{}}]){
  assert.throws(()=>manager.ingestOfficialExport([raw]),/conversaci|identidad|mapping|nodo|formato/i,JSON.stringify(raw));
 }
});

test('official import rejects duplicate source identities before one can overwrite another',()=>{
 assert.throws(()=>manager.ingestOfficialExport([conversation('repeated'),conversation('repeated')]),/duplicad|repetid/i);
});

test('official import validates every entry before normalizing and retains supported export shapes',()=>{
 assert.throws(()=>manager.ingestOfficialExport([conversation('good'),{foo:'wrong file'}]),/conversaci|identidad|mapping|formato/i);
 const raw=conversation('one');delete raw.id;raw.conversation_id='one';
 const imported=manager.ingestOfficialExport([raw,conversation('two')]);
 assert.equal(imported.length,2);
 assert.equal(imported[0].canonicalId,'conv_chatgpt_one');
 assert.equal(imported[1].canonicalId,'conv_chatgpt_two');
 assert.equal(imported[0].messages.length,2);
 assert.deepEqual(manager.ingestOfficialExport([]),[]);
});
