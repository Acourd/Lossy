/**
 * Liner Context Portability — Generador de Paquetes ZIP Puro (Zero-Dependencies)
 * Construye archivos PKZip conformes a la especificación estándar (APPNOTE.TXT)
 * para exportaciones masivas sin generar descargas múltiples ni requerir librerías externas.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || root.Liner;
    const builder = factory();
    root.Liner.ZipBuilder = builder;
    root.Lossy.ZipBuilder = builder;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  }

  const CRC_TABLE = makeCrcTable();

  function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  /**
   * Genera un paquete ZIP determinista en formato Uint8Array a partir de un mapa de archivos.
   * @param {Record<string, string | Uint8Array>} files - Mapa de rutas a contenidos
   * @returns {Uint8Array} Bytes del archivo ZIP
   */
  function normalizePath(rawPath) {
    const name=String(rawPath).replace(/\\/g,'/');
    if(!name || name.startsWith('/') || /^[a-z]:/i.test(name) || /[\x00-\x1f]/.test(name))throw new Error('Ruta ZIP no válida');
    const parts=(name.endsWith('/')?name.slice(0,-1):name).split('/');
    if(parts.some(part=>!part || part==='.' || part==='..'))throw new Error('Ruta ZIP no válida');
    return name;
  }
  const MAX_FILE_BYTES=256*1024*1024;
  const MAX_TOTAL_BYTES=512*1024*1024;
  function readEntries(input, options = {}) {
    if(!(input instanceof Uint8Array))throw new Error('ZIP requiere bytes Uint8Array');
    const bytes=input,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const decoder=new TextDecoder('utf-8',{fatal:true});
    const bounds=(offset,size)=>{if(!Number.isSafeInteger(offset)||offset<0||size<0||offset+size>bytes.length)throw new Error('ZIP truncado o directorio no válido');};
    let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
    if(end<0)throw new Error('ZIP inválido: no se encontró el directorio final');
    if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('ZIP dividido en discos no admitido');
    const count=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),central=view.getUint32(end+16,true);
    if(count===65535||central===0xffffffff||centralSize===0xffffffff)throw new Error('ZIP64 no admitido');
    if(view.getUint16(end+8,true)!==count||count>Math.min(65534,options.maxEntries||20000))throw new Error('ZIP: número de entradas no válido');
    bounds(central,centralSize);if(central+centralSize>end)throw new Error('Directorio ZIP fuera de límites');
    const entries=[],names=new Set(),ranges=[];let pos=central,total=0;
    for(let i=0;i<count;i++){
      bounds(pos,46);if(pos+46>central+centralSize||view.getUint32(pos,true)!==0x02014b50)throw new Error('Directorio ZIP dañado');
      const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),crc=view.getUint32(pos+16,true),compressed=view.getUint32(pos+20,true),size=view.getUint32(pos+24,true);
      const nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true);
      if(flags&65)throw new Error('ZIP cifrado no admitido');
      if(![0,8].includes(method))throw new Error('Método de compresión ZIP no admitido');
      const next=pos+46+nameLength+extra+comment;bounds(pos,next-pos);if(next>central+centralSize)throw new Error('Directorio ZIP truncado');
      const originalName=decoder.decode(bytes.subarray(pos+46,pos+46+nameLength)),name=normalizePath(originalName);
      if(names.has(name))throw new Error('Nombre ZIP duplicado tras normalizar la ruta');names.add(name);
      if(!options.filter||options.filter({name,size,compressedSize:compressed})){total+=size;if(size>MAX_FILE_BYTES||total>MAX_TOTAL_BYTES)throw new Error('ZIP supera el límite de descompresión');}
      bounds(local,30);if(view.getUint32(local,true)!==0x04034b50||local>=central)throw new Error('Cabecera local ZIP dañada');
      const localFlags=view.getUint16(local+6,true),localMethod=view.getUint16(local+8,true),localNameLength=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true);
      const start=local+30+localNameLength+localExtra;bounds(local,start-local);bounds(start,compressed);
      if(start+compressed>central||localFlags!==flags||localMethod!==method)throw new Error('Cabeceras ZIP incompatibles');
      if(decoder.decode(bytes.subarray(local+30,local+30+localNameLength))!==originalName)throw new Error('Nombre ZIP local incompatible');
      if(!(flags&8)&&(view.getUint32(local+14,true)!==crc||view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==size))throw new Error('Metadatos ZIP incompatibles');
      if(method===0 && compressed!==size)throw new Error('Tamaño ZIP sin compresión incompatible');
      ranges.push([local,start+compressed]);
      entries.push({name,method,crc,size,data:bytes.subarray(start,start+compressed)});pos=next;
    }
    if(pos!==central+centralSize)throw new Error('Directorio ZIP incompleto');
    ranges.sort((a,b)=>a[0]-b[0]);
    for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw new Error('Entradas ZIP superpuestas');
    return entries;
  }
  function acceptEntry(files,entry,data){
    if(data.length!==entry.size||crc32(data)!==entry.crc)throw new Error('Integridad ZIP no válida: tamaño o CRC incorrecto');
    const value=typeof Buffer!=='undefined'&&typeof Buffer.from==='function'?Buffer.from(data.buffer,data.byteOffset,data.byteLength):data;
    Object.defineProperty(files,entry.name,{value,enumerable:true,writable:true,configurable:true});
  }

  function createZip(files = {}) {
    const textEncoder = new TextEncoder();
    const fileEntries = [];
    let offset = 0;
    const names=new Set();

    for (const [rawPath, content] of Object.entries(files)) {
      const normalizedPath=normalizePath(rawPath);
      if(names.has(normalizedPath))throw new Error('Nombre ZIP duplicado tras normalizar la ruta');names.add(normalizedPath);
      if(names.size>=65535)throw new Error('Demasiados archivos para ZIP estándar');
      const filenameBytes = textEncoder.encode(normalizedPath);
      const dataBytes = typeof content === 'string' ? textEncoder.encode(content) : content instanceof ArrayBuffer ? new Uint8Array(content) : content;
      if(!(dataBytes instanceof Uint8Array))throw new Error('Contenido ZIP no válido');
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + filename)
      const localHeader = new Uint8Array(30 + filenameBytes.length);
      const view = new DataView(localHeader.buffer);
      view.setUint32(0, 0x04034b50, true); // Local file header signature
      view.setUint16(4, 20, true);         // Version needed to extract (2.0)
      view.setUint16(6, 0x0800, true);     // Flags: bit 11 = UTF-8 filenames
      view.setUint16(8, 0, true);          // Compression: 0 = Store (no compression)
      view.setUint16(10, 0, true);         // Mod time
      view.setUint16(12, 0, true);         // Mod date
      view.setUint32(14, crc, true);       // CRC-32
      view.setUint32(18, size, true);      // Compressed size
      view.setUint32(22, size, true);      // Uncompressed size
      view.setUint16(26, filenameBytes.length, true); // Filename length
      view.setUint16(28, 0, true);         // Extra field length
      localHeader.set(filenameBytes, 30);

      fileEntries.push({
        filenameBytes,
        dataBytes,
        crc,
        size,
        offset,
        localHeader
      });

      offset += localHeader.length + dataBytes.length;
    }

    // Central Directory
    let centralDirSize = 0;
    const centralHeaders = [];
    for (const entry of fileEntries) {
      const header = new Uint8Array(46 + entry.filenameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x02014b50, true); // Central directory header signature
      view.setUint16(4, 20, true);         // Version made by
      view.setUint16(6, 20, true);         // Version needed to extract
      view.setUint16(8, 0x0800, true);     // Flags: UTF-8
      view.setUint16(10, 0, true);        // Compression: 0
      view.setUint16(12, 0, true);        // Mod time
      view.setUint16(14, 0, true);        // Mod date
      view.setUint32(16, entry.crc, true); // CRC-32
      view.setUint32(20, entry.size, true); // Compressed size
      view.setUint32(24, entry.size, true); // Uncompressed size
      view.setUint16(28, entry.filenameBytes.length, true); // Filename length
      view.setUint16(30, 0, true);         // Extra field length
      view.setUint16(32, 0, true);         // File comment length
      view.setUint16(34, 0, true);         // Disk number start
      view.setUint16(36, 0, true);         // Internal file attributes
      view.setUint32(38, 0, true);         // External file attributes
      view.setUint32(42, entry.offset, true); // Relative offset of local header
      header.set(entry.filenameBytes, 46);

      centralHeaders.push(header);
      centralDirSize += header.length;
    }

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Number of this disk
    eocdView.setUint16(6, 0, true);          // Disk with central directory
    eocdView.setUint16(8, fileEntries.length, true);  // Entries on this disk
    eocdView.setUint16(10, fileEntries.length, true); // Total entries
    eocdView.setUint32(12, centralDirSize, true);     // Central directory size
    eocdView.setUint32(16, offset, true);             // Offset of central directory
    eocdView.setUint16(20, 0, true);                  // Comment length

    const totalBytes = offset + centralDirSize + eocd.length;
    const zip = new Uint8Array(totalBytes);
    let pos = 0;

    for (const entry of fileEntries) {
      zip.set(entry.localHeader, pos);
      pos += entry.localHeader.length;
      zip.set(entry.dataBytes, pos);
      pos += entry.dataBytes.length;
    }

    for (const ch of centralHeaders) {
      zip.set(ch, pos);
      pos += ch.length;
    }

    zip.set(eocd, pos);
    return zip;
  }

  /**
   * Extrae los archivos de un paquete ZIP generado (o cualquier ZIP sin compresión estándar).
   * @param {Uint8Array} zipBytes - Bytes del archivo ZIP
   * @returns {Record<string, Uint8Array | Buffer>} Mapa de nombres de archivo a contenidos binarios
   */
  function parseZip(zipBytes) {
    const files={};
    for(const entry of readEntries(zipBytes)){
      if(entry.method!==0)throw new Error('ZIP comprimido: usa unzip para descomprimir');
      acceptEntry(files,entry,entry.data);
    }
    return files;
  }

  async function unzip(zipBuffer, options = {}) {
    const bytes=zipBuffer instanceof Uint8Array?zipBuffer:new Uint8Array(zipBuffer);
    const files={};
    for(const entry of readEntries(bytes,options)){
      if(options.filter&&!options.filter({name:entry.name,size:entry.size,compressedSize:entry.data.length}))continue;
      let data=entry.data;
      if(entry.method===8){
        if(typeof process!=='undefined' && process.versions?.node && typeof require==='function'){
          data=new Uint8Array(require('node:zlib').inflateRawSync(data,{maxOutputLength:Math.max(1,entry.size)}));
        }else{
          if(typeof DecompressionStream==='undefined')throw new Error('Descompresión ZIP no disponible');
          const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
          const chunks=[];let total=0;
          try{
            while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.length;if(total>entry.size||total>MAX_FILE_BYTES){await reader.cancel();throw new Error('ZIP supera el tamaño de descompresión declarado');}chunks.push(chunk.value);}
          }finally{reader.releaseLock();}
          data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
        }
      }
      acceptEntry(files,entry,data);
    }
    return files;
  }

  return {
    crc32,
    createZip,
    parseZip,
    unzip,
    inspect: bytes => readEntries(bytes,{filter:()=>false,maxEntries:65534}).map(entry=>({name:entry.name,size:entry.size,compressedSize:entry.data.length}))
  };
});
