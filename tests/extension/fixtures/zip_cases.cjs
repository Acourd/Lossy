'use strict';
const {deflateRawSync}=require('node:zlib');
const {createZip}=require('../../../extension/src/core/portability/zip_builder');
function deflatedZip(name,text){
 const stored=createZip({[name]:text}),view=new DataView(stored.buffer,stored.byteOffset,stored.byteLength);
 const central=view.getUint32(stored.length-6,true),start=30+view.getUint16(26,true);
 const local=stored.slice(0,start),directory=stored.slice(central,-22),end=stored.slice(-22),data=deflateRawSync(Buffer.from(text));
 const lv=new DataView(local.buffer),dv=new DataView(directory.buffer),ev=new DataView(end.buffer);
 lv.setUint16(8,8,true);lv.setUint32(18,data.length,true);dv.setUint16(10,8,true);dv.setUint32(20,data.length,true);ev.setUint32(16,local.length+data.length,true);
 return new Uint8Array(Buffer.concat([local,data,directory,end]));
}
module.exports={deflatedZip};
