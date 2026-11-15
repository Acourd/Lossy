(function(){
 'use strict';
 const model=Lossy.DocumentModel,db=new LinerDB(),selected=new Set();let entities=[],project,prepared,sequence=0,renderTimer,rendering=Promise.resolve();
 const $=id=>document.getElementById(id),controls=['document-title','page-size','orientation','page-margin','document-font','font-size','include-images','include-sources','page-breaks','include-project'];
 function settings(){return{title:$('document-title').value,pageSize:$('page-size').value,orientation:$('orientation').value,margin:$('page-margin').value,font:$('document-font').value,fontSize:$('font-size').value,includeImages:$('include-images').checked,includeSources:$('include-sources').checked,pageBreaks:$('page-breaks').checked,includeProject:$('include-project').checked,project};}
 function status(text,type=''){const el=$('document-status');el.textContent=text;el.className='document-status '+type;}
 function buttons(enabled){for(const id of ['btn-print','btn-markdown-zip','btn-markdown-single'])$(id).disabled=!enabled||(id==='btn-print'&&(prepared?.pageOverflow||prepared?.imageFailures));}
 function renderChoices(){
  $('message-list').innerHTML=entities.map(entity=>'<div class="message-source">'+model.escape(entity.title||'Conversación')+'</div>'+model.messagesFor(entity).map((message,index)=>'<label class="message-choice"><input type="checkbox" data-key="'+model.escape(model.keyFor(entity,index))+'" '+(selected.has(model.keyFor(entity,index))?'checked':'')+'><div><strong>'+(message.role==='user'?'Usuario':'Asistente')+' · '+(index+1)+'</strong><span>'+model.escape(message.text||message.content?.text||'Mensaje con imágenes o archivos')+'</span></div></label>').join('')).join('');
  $('message-list').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{if(input.checked)selected.add(input.dataset.key);else selected.delete(input.dataset.key);schedule();}));
 }
 function schedule(){clearTimeout(renderTimer);sequence++;buttons(false);renderTimer=setTimeout(()=>{rendering=refresh();},150);}
 async function refresh(){
  const current=++sequence;buttons(false);const subset=model.selectEntities(entities,selected),count=subset.reduce((sum,item)=>sum+model.messagesFor(item).length,0);$('selection-count').textContent=count+' mensajes seleccionados';$('font-size-label').value=$('font-size').value;
  if(!count){prepared=undefined;$('document-preview').srcdoc='<!doctype html><html lang="es"><body><p>Selecciona al menos un mensaje para preparar el documento.</p></body></html>';$('preview-summary').textContent='Sin mensajes seleccionados';status('Elige el contenido que quieres conservar.');return;}
  status('Preparando la vista previa…');
  try{
   const result=await model.prepare(subset,settings());if(current!==sequence)return;prepared=result;
   const frame=$('document-preview');frame.style.width=Math.ceil(result.page.width*96/25.4)+'px';frame.style.minHeight=Math.ceil(result.page.height*96/25.4)+'px';frame.style.height=frame.style.minHeight;
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No se pudo cargar la vista previa')),15000);frame.onload=()=>{clearTimeout(timeout);try{frame.style.height=Math.max(frame.contentDocument.documentElement.scrollHeight,Math.ceil(result.page.height*96/25.4))+'px';resolve();}catch(error){reject(error);}};frame.srcdoc=result.html;});
   if(current!==sequence)return;
   const paper=frame.contentDocument.querySelector('.document'),bounds=paper.getBoundingClientRect(),style=frame.contentWindow.getComputedStyle(paper),left=bounds.left+parseFloat(style.paddingLeft),right=bounds.right-parseFloat(style.paddingRight);
   result.pageOverflow=[...paper.querySelectorAll('math,table,pre,img')].some(element=>{const box=element.getBoundingClientRect();return box.left<left-2||box.right>right+2;});
   if(result.pageOverflow)result.warnings.push('Hay contenido más ancho que la página. Cambia a horizontal o reduce el tamaño del texto para guardar el PDF. Markdown sigue disponible.');
   result.imageFailures=[...frame.contentDocument.images].filter(image=>!image.complete||!image.naturalWidth).length;
   if(result.imageFailures)result.warnings.push(result.imageFailures+' imágenes no se pudieron abrir. Actualiza la captura u omite las imágenes para guardar el PDF.');
   document.title=result.settings.title+' · Lossy';$('paper-label').textContent=(result.settings.pageSize==='a4'?'A4':'Carta')+' · '+(result.settings.orientation==='landscape'?'Horizontal':'Vertical');$('preview-summary').textContent=result.messageCount+' mensajes · '+result.imageCount+' imágenes incluidas';status(result.warnings.join(' '),result.warnings.length?'warning':'');buttons(true);
  }catch(error){if(current!==sequence)return;prepared=undefined;status(error.message,'error');}
 }
 async function latest(){clearTimeout(renderTimer);await rendering;if(!prepared||$('btn-print').disabled){rendering=refresh();await rendering;}if(!prepared)throw Error('Prepara al menos un mensaje antes de exportar');return prepared;}
 function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 async function markdown(strategy){
  try{const result=await latest();buttons(false);const filename=Lossy.ExportCenter.getSafeFilename(result.settings.title,'md');
   if(strategy==='package'){
    const files={[filename]:result.markdown,...result.files,'manifest.json':JSON.stringify({version:'1.0',kind:'lossy-document',title:result.settings.title,selectedMessageCount:result.messageCount,includedImageCount:result.imageCount,missingImageCount:result.missingImages,settings:result.settings,warnings:result.warnings},null,2)};download(Lossy.ZipBuilder.createZip(files),filename.replace(/\.md$/,'.zip'),'application/zip');
   }else{
    let text=result.markdown;for(const[name,bytes]of Object.entries(result.files)){const mime=/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':/\.gif$/i.test(name)?'image/gif':'image/png';let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);text=text.replaceAll('](<assets/'+encodeURIComponent(name.slice('assets/'.length))+'>)','](<data:'+mime+';base64,'+btoa(binary)+'>)');}download(text,filename,'text/markdown;charset=utf-8');
   }
   status('Descarga preparada con '+result.messageCount+' mensajes.'+(result.warnings.length?' '+result.warnings.join(' '):''),result.warnings.length?'warning':'');buttons(true);
  }catch(error){status(error.message,'error');buttons(Boolean(prepared));}
 }
 $('btn-print').addEventListener('click',async()=>{try{await latest();const frame=$('document-preview');await frame.contentDocument.fonts.ready;await Promise.all([...frame.contentDocument.images].map(image=>image.decode().catch(()=>{throw Error('No se pudo preparar una imagen para imprimir');})));frame.contentWindow.focus();frame.contentWindow.print();status('Se abrió la impresión del navegador. Elige «Guardar como PDF». Puedes cancelar sin modificar tus fuentes.');}catch(error){status(error.message,'error');}});
 $('btn-markdown-zip').addEventListener('click',()=>markdown('package'));$('btn-markdown-single').addEventListener('click',()=>markdown('embed'));
 for(const id of controls)$(id).addEventListener('input',schedule);
 $('btn-select-all').addEventListener('click',()=>{entities.forEach(entity=>model.messagesFor(entity).forEach((_message,index)=>selected.add(model.keyFor(entity,index))));renderChoices();schedule();});$('btn-select-none').addEventListener('click',()=>{selected.clear();renderChoices();schedule();});
 (async()=>{
  try{const query=new URLSearchParams(location.search),ids=[...new Set(query.getAll('id'))];if(!ids.length||ids.length>100)throw Error('Elige entre 1 y 100 conversaciones desde la biblioteca.');
   for(const id of ids){const entity=await db.getConversation(id);if(!entity)throw Error('Una fuente ya no está disponible. Vuelve a seleccionarla desde la biblioteca.');entities.push(entity);}
   if(query.get('project'))project=await db.getCollection(query.get('project'));if(project){$('project-option').classList.remove('hidden');if(ids.some(id=>!project.conversationIds.includes(id)))throw Error('La selección no pertenece al proyecto indicado.');}
   $('document-title').value=project?.name||(entities.length===1?entities[0].title:'Selección de conversaciones');entities.forEach(entity=>model.messagesFor(entity).forEach((_message,index)=>selected.add(model.keyFor(entity,index))));renderChoices();rendering=refresh();await rendering;
  }catch(error){status(error.message,'error');buttons(false);$('preview-summary').textContent='No se pudo preparar el documento';}
 })();
})();
