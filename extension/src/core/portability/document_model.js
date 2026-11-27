/** Shared selection, resource preparation and content for document preview and Markdown. */
(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('../../../vendor/markdown-it.min'),require('../../../vendor/katex.min'),require('./export_center'),require('./transfer_bundle'),require('../chatgpt_widgets'));
 else{root.Lossy=root.Lossy||{};root.Lossy.DocumentModel=factory(root.markdownit,root.katex,root.Lossy.ExportCenter,root.Lossy.TransferBundle,root.Lossy.ChatGPTWidgets);}
})(typeof globalThis!=='undefined'?globalThis:this,function(markdownit,katex,exporter,transfer,widgets){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dimensions={a4:[210,297],letter:[215.9,279.4]},margins={normal:20,narrow:12,wide:28};
 function normalizeSettings(options={}){
  const size=Object.hasOwn(dimensions,options.pageSize)?options.pageSize:'a4',orientation=options.orientation==='landscape'?'landscape':'portrait',margin=Object.hasOwn(margins,options.margin)?options.margin:'normal',font=['sans','serif','mono'].includes(options.font)?options.font:'sans',fontSize=Number(options.fontSize)||11;
  if(fontSize<8||fontSize>18)throw Error('El tamaño de texto debe estar entre 8 y 18 puntos');
  return{title:String(options.title||'Documento Lossy').trim().slice(0,500)||'Documento Lossy',pageSize:size,orientation,margin,font,fontSize,includeImages:options.includeImages!==false,includeSources:options.includeSources!==false,pageBreaks:options.pageBreaks===true,includeProject:options.includeProject!==false};
 }
 const isInternalToolPayload=msg=>{
  if(!msg||msg.role==='user')return false;
  if(msg.isConversational===false||msg.role==='tool'||msg.nodeCategory==='tool')return true;
  const t=String(msg?.text??msg?.content?.text??'').trim();
  return /^\{[\s\S]*"path"\s*:\s*"\/Automations\//i.test(t);
 };
 const messagesFor=entity=>(entity.selectedMessages||entity.messages||[]).filter(m=>m.isConversational!==false&&['user','assistant'].includes(m.role)&&!isInternalToolPayload(m));
 const keyFor=(entity,index)=>entity.canonicalId+'::'+index;
 function selectEntities(entities,selected){
  return entities.flatMap(entity=>{
   const all=messagesFor(entity),messages=all.filter((_message,index)=>selected.has(keyFor(entity,index))).map(message=>structuredClone(message));if(!messages.length)return[];
   const selectedIds=new Set(messages.map(message=>message.id).filter(Boolean));const attachments=(entity.attachments||[]).filter(asset=>messages.length===all.length||selectedIds.has(asset.sourceMessageId)||selectedIds.has(asset.messageId));
   return[{...structuredClone(entity),attachments,messages,...(entity.selectedMessages?{selectedMessages:messages}:{}),conversationMessageCount:messages.length,visibleMessageCount:messages.length}];
  });
 }
 function parser(warnings){
  const md=markdownit({html:false,linkify:false,breaks:false,typographer:false});
  md.renderer.rules.image=(tokens,index)=>{const token=tokens[index],src=token.attrGet('src')||'',label=token.content||'Imagen';return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(src)?'<figure><img src="'+escape(src)+'" alt="'+escape(label)+'"><figcaption>'+escape(label)+'</figcaption></figure>':'<span class="missing-image">Imagen no incluida: '+escape(label)+'</span>';};
  const linkOpen=md.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
  md.renderer.rules.link_open=(tokens,index,options,env,self)=>{const href=tokens[index].attrGet('href')||'';if(!/^(https?:|mailto:)/i.test(href))tokens[index].attrSet('href','#');tokens[index].attrSet('rel','noopener noreferrer');tokens[index].attrSet('target','_blank');return linkOpen(tokens,index,options,env,self);};
  const math=(source,display)=>{try{return katex.renderToString(source,{output:'mathml',displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:20});}catch(error){warnings.push('Una fórmula no se pudo representar; se conserva su código.');return '<code class="math-error">'+escape(source)+'</code>';}};
  md.inline.ruler.before('escape','lossy_math',(state,silent)=>{
   const start=state.pos,escaped=state.src.startsWith('\\(',start),dollar=state.src[start]==='$'&&state.src[start+1]!=='$';if(!escaped&&!dollar)return false;
   const open=escaped?2:1,close=escaped?'\\)':'$',end=state.src.indexOf(close,start+open);if(end<0||end-start>20000)return false;
   const content=state.src.slice(start+open,end);if(!content.trim()||(!escaped&&(/^\s|\s$/.test(content)||/\d/.test(state.src[end+1]||''))))return false;
   if(!silent){const token=state.push('lossy_math','math',0);token.content=content;}state.pos=end+close.length;return true;
  });
  md.renderer.rules.lossy_math=(tokens,index)=>math(tokens[index].content,false);
  md.block.ruler.before('fence','lossy_math_block',(state,start,end,silent)=>{
   const line=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]).trim(),open=line.startsWith('$$')?'$$':line.startsWith('\\[')?'\\[':null;if(!open)return false;const close=open==='$$'?'$$':'\\]';let content=line.slice(2),last=start,found=content.endsWith(close);if(found)content=content.slice(0,-close.length);
   while(!found&&++last<end){const next=state.src.slice(state.bMarks[last]+state.tShift[last],state.eMarks[last]);const at=next.indexOf(close);content+='\n'+(at<0?next:next.slice(0,at));found=at>=0;if(content.length>20000)return false;}
   if(!found)return false;if(silent)return true;const token=state.push('lossy_math_block','math',0);token.content=content;token.block=true;state.line=last+1;return true;
  });
  md.renderer.rules.lossy_math_block=(tokens,index)=>'<div class="math-display">'+math(tokens[index].content,true)+'</div>';
  const rawRender=md.render.bind(md);
  md.render=function(src,env){
   if(!widgets||typeof widgets.findTopLevelWidgetRanges!=='function')return rawRender(src,env);
   const blocks=[],inlines=[];
   const isEscaped=(str,idx)=>{let bs=0;for(let k=idx-1;k>=0&&str[k]==='\\';k--)bs++;return (bs%2)===1;};
   const segs=typeof widgets.splitFencedCodeSegments==='function'
    ?widgets.splitFencedCodeSegments(src)
    :String(src||'').split(/(```[\s\S]*?```)/g).map((text,idx)=>({isCode:idx%2===1,text}));
   const processed=segs.map(seg=>{
    if(seg.isCode)return seg.text;
    const part=seg.text,initContainers=seg.initialContainers;
    const widgetRanges=widgets.findTopLevelWidgetRanges(part,initContainers).map(r=>({kind:'widget',start:r.start,end:r.end,raw:r.raw}));
    const inlineRanges=typeof widgets.findInlineCodeRanges==='function'?widgets.findInlineCodeRanges(part,initContainers).map(r=>({kind:'inline',start:r.start,end:r.end})):[];
    const events=[...widgetRanges,...inlineRanges].sort((a,b)=>a.start-b.start);
    const stripPlain=typeof widgets.stripControlTokensPlain==='function'?widgets.stripControlTokensPlain:s=>widgets.stripControlTokensOnly(s);
    const cleanPlainChunk=plain=>{
     let p=stripPlain(plain);
     p=p.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi,(m,a,inner,offset,str)=>{
      if(isEscaped(str,offset))return m;
      const colorMatch=String(a||'').match(/color\s*=\s*["']([^"']+)["']/i);
      const colorMap={success:'#15803d',warning:'#b45309',danger:'#b91c1c',error:'#b91c1c',secondary:'#5c7068',muted:'#6b7f77'};
      const hex=colorMatch&&colorMap[colorMatch[1].toLowerCase()];
      const id='LOSSYINLINE'+inlines.length+'END';
      inlines.push(hex?'<span style="color:'+hex+';font-weight:600">'+escape(inner.trim())+'</span>':escape(inner.trim()));
      return id;
     });
     p=p.replace(/<caption\b[^>]*>([\s\S]*?)<\/caption>/gi,(m,inner,offset,str)=>{
      if(isEscaped(str,offset))return m;
      const id='LOSSYBLOCK'+blocks.length+'END';
      blocks.push('<p class="lossy-widget-caption">'+escape(widgets.stripControlTokensOnly(inner).trim())+'</p>');
      return '\n\n'+id+'\n\n';
     });
     p=p.replace(/<Link\b[^>]*url\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})[^>]*>([\s\S]*?)<\/Link>/gi,(m,u1,u2,_u3,label,offset,str)=>{
      if(isEscaped(str,offset))return m;
      const url=u1||u2||'';
      return /^https?:\/\//i.test(url)?'['+label.trim()+']('+url+')':label.trim();
     });
     p=p.replace(/<divider\s*\/>/gi,(m,offset,str)=>isEscaped(str,offset)?m:'\n\n---\n\n');
     return p;
    };
    let out='',cursor=0;
    for(const ev of events){
     if(ev.start<cursor)continue;
     out+=cleanPlainChunk(part.slice(cursor,ev.start));
     if(ev.kind==='inline'){
      out+=part.slice(ev.start,ev.end);
     }else{
      const id='LOSSYBLOCK'+blocks.length+'END';
      blocks.push(widgets.renderWidgetBlockToHtml(ev.raw));
      out+='\n\n'+id+'\n\n';
     }
     cursor=ev.end;
    }
    out+=cleanPlainChunk(part.slice(cursor));
    return out;
   }).join('\n');
   let html=rawRender(processed,env);
   blocks.forEach((b,i)=>{html=html.replace('<p>LOSSYBLOCK'+i+'END</p>',b).replace('LOSSYBLOCK'+i+'END',b);});
   inlines.forEach((v,i)=>{html=html.replace('LOSSYINLINE'+i+'END',v);});
   return html;
  };
  return md;
 }
 function messageMarkdown(message,index,options){
  return exporter.formatMessageMarkdown(message,index,options);
 }
 async function prepare(entities,options={}){
  const settings=normalizeSettings(options),warnings=[],md=parser(warnings),documents=[],files={},markdown=['# '+settings.title,''];let imageCount=0,missing=0,messageCount=0;
  let projectHtml='';if(options.project&&settings.includeProject){const briefSources=settings.includeSources?entities:entities.map(entity=>({...entity,source:{...entity.source,url:undefined},sourceURL:undefined}));const brief=transfer.buildProjectBrief(options.project,briefSources).replace(/^# [^\n]*\n/,'');projectHtml='<section class="project-state">'+md.render(brief)+'</section>';markdown.push(brief,'---','');}
  for(const [index,entity]of entities.entries()){
   const resolved=settings.includeImages?await exporter.AssetResolver.resolveAssetBinaries(entity,{fetch:async()=>{throw Error('Recurso no guardado localmente. Actualiza la captura para recuperarlo.');}}):{assets:[],assetBinaryMap:new Map()},assets=resolved.assets||[],map=resolved.assetBinaryMap||new Map();
   for(const asset of assets){const bytes=map.get(asset.assetId)||map.get(asset.id)||map.get(asset.filename);asset.filename=String(index+1).padStart(3,'0')+'_'+asset.filename;if(bytes?.length){files['assets/'+asset.filename]=bytes;map.set(asset.filename,bytes);if(asset.mimeType?.startsWith('image/'))imageCount++;}else if(asset.mimeType?.startsWith('image/')||asset.kind==='image')missing++;}
   const messages=messagesFor(entity),parts=[];if(entities.length>1)markdown.push('## '+(entity.title||'Conversación'),'');
   const sourceUrl=entity.source?.url||entity.sourceURL||(entity.source?.platform==='chatgpt'&&entity.source?.conversationId?'https://chatgpt.com/c/'+encodeURIComponent(entity.source.conversationId):'');
   const source=settings.includeSources&&/^https?:\/\//i.test(sourceUrl)?'<a href="'+escape(sourceUrl)+'" target="_blank" rel="noopener noreferrer">Abrir fuente original</a>':'';
   if(source)markdown.push('> Fuente: [Abrir fuente original](<'+sourceUrl.replace(/>/g,'%3E').replace(/[\r\n]/g,'')+'>)','','');
   for(const [messageIndex,message]of messages.entries()){
    const plat=(entity.source?.platform||entity.sourcePlatform||'assistant').toLowerCase();
    const aiLabel=plat==='chatgpt'?'ChatGPT':plat==='gemini'?'Gemini':plat==='claude'?'Claude':'Asistente';
    const role=message.role==='user'?'Usuario':aiLabel;
    const embedded=messageMarkdown(message,messageIndex,{assets,assetBinaryMap:map,imageStrategy:settings.includeImages?'embed':'omit',preserveRawWidgets:true}),packaged=messageMarkdown(message,messageIndex,{assets,assetBinaryMap:map,imageStrategy:settings.includeImages?'package':'omit'});
    parts.push('<section class="message"><h3 class="role role-'+message.role+'">'+role+'</h3><div class="message-content">'+md.render(embedded)+'</div></section>');markdown.push('### '+role,'',packaged,'');messageCount++;
   }
   documents.push('<section class="source-document">'+(entities.length>1?'<h2>'+escape(entity.title||'Conversación')+'</h2>':'')+(source?'<p class="source-link">'+source+'</p>':'')+parts.join('')+'</section>');
  }
  if(missing)warnings.push(missing+' imágenes no están disponibles localmente. Se indican en el documento.');
  const sizes=dimensions[settings.pageSize],width=settings.orientation==='landscape'?sizes[1]:sizes[0],height=settings.orientation==='landscape'?sizes[0]:sizes[1],margin=margins[settings.margin],font={sans:'Arial, "Segoe UI", sans-serif',serif:'Georgia, "Times New Roman", serif',mono:'Consolas, "Courier New", monospace'}[settings.font];
  const css='@page{size:'+width+'mm '+height+'mm;margin:'+margin+'mm;@bottom-right{content:counter(page);font:9pt Arial;color:#5c6863}}*{box-sizing:border-box}html{color-scheme:light}body{color:#182d27;background:#fff;font:'+settings.fontSize+'pt/1.62 '+font+';margin:0;overflow-wrap:anywhere}.document{padding:'+margin+'mm;max-width:'+width+'mm;margin:auto}h1{font-size:2.25em;line-height:1.15;letter-spacing:-.04em;margin:0 0 8mm}h2{font-size:1.45em;margin:8mm 0 4mm}h1,h2,h3,h4{break-after:avoid-page}p{orphans:3;widows:3}a{color:#245d4d;text-decoration:underline}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#f3f5f3;border:1px solid #d8e0dc;padding:4mm;font:0.88em/1.55 Consolas,monospace}code{font-family:Consolas,monospace;font-size:.9em}blockquote{margin-left:0;padding-left:4mm;border-left:2px solid #779e8f;color:#40584d}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.9em;margin:5mm 0}th,td{border:1px solid #bbcfc4;padding:2.2mm;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group;background:#edf3ef}tr{break-inside:avoid}figure{margin:5mm 0;break-inside:avoid}img{display:block;max-width:100%;height:auto;max-height:'+(height-2*margin-25)+'mm;object-fit:contain}figcaption{font-size:.78em;color:#536b5f;margin-top:2mm}.message-content h1{font-size:1.6em;line-height:1.2;margin:5mm 0}.role{font:600 .8em Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;padding-bottom:2mm;border-bottom:1px solid #cbdad1;margin:7mm 0 3mm;color:#245d4d}.role-user{color:#40536b}.source-link{font-size:.8em}.project-state{border:1px solid #cbdad1;padding:5mm;margin:6mm 0}.project-state h2{font-size:1.1em}.project-state h2:first-child{margin-top:0}.missing-image,.math-error{color:#8a371e;border-bottom:1px dotted currentColor}.math-display{text-align:center;overflow-wrap:anywhere;margin:5mm 0;break-inside:avoid}math{font-family:"Cambria Math",math;font-size:1.08em}.message{break-inside:auto}'+(widgets?.WIDGET_PRINT_CSS||'')+(settings.pageBreaks?'.message~.message,.source-document~.source-document{break-before:page}':'')+'@media print{html,body{width:auto!important;background:#fff}.document{padding:0;max-width:none;margin:0}thead{print-color-adjust:exact}pre,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src \'none\'; base-uri \'none\'"><title>'+escape(settings.title)+'</title><style>'+css+'</style></head><body><article class="document"><h1>'+escape(settings.title)+'</h1>'+projectHtml+documents.join('')+'</article></body></html>';
  return{html,markdown:markdown.join('\n'),files,settings,messageCount,imageCount,missingImages:missing,warnings:[...new Set(warnings)],page:{width,height,margin}};
 }
 return{normalizeSettings,messagesFor,keyFor,selectEntities,prepare,escape,renderMarkdown:(text,warnings=[])=>parser(warnings).render(String(text||''))};
});
