
const fs=require('fs'),zlib=require('zlib');
const m=require('../art/manifest.json');
for (const key of ['ui.card','ui.card_selected','ui.card_locked','ui.node_owned']){
  const p=Array.isArray(m[key])?m[key][0]:m[key];
  const b=fs.readFileSync('../'+p);
  let off=8, w=0,h=0,bd=0,ct=0, idat=[];
  while(off<b.length){const len=b.readUInt32BE(off);const type=b.toString('ascii',off+4,off+8);const data=b.slice(off+8,off+8+len);
    if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);bd=data[8];ct=data[9];}
    if(type==='IDAT')idat.push(data);
    off+=12+len;}
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct===6?4:ct===2?3:1;
  const stride=w*bpp;
  const out=Buffer.alloc(h*stride);
  let prev=Buffer.alloc(stride);
  for(let y=0;y<h;y++){
    const f=raw[y*(stride+1)];
    const line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));
    const cur=Buffer.alloc(stride);
    for(let x=0;x<stride;x++){
      const a=x>=bpp?cur[x-bpp]:0, bb=prev[x], c=x>=bpp?prev[x-bpp]:0;
      let v=line[x];
      if(f===1)v=(v+a)&255; else if(f===2)v=(v+bb)&255; else if(f===3)v=(v+((a+bb)>>1))&255;
      else if(f===4){const pa=Math.abs(bb-c),pb=Math.abs(a-c),pc=Math.abs(a+bb-2*c);const pr=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c);v=(v+pr)&255;}
      cur[x]=v;
    }
    cur.copy(out,y*stride); prev=cur;
  }
  console.log('== '+key+' '+w+'x'+h+' ct='+ct);
  for(let y=0;y<h;y++){
    let row='';
    for(let x=0;x<w;x++){
      const i=y*stride+x*bpp;
      if(ct===6){const r=out[i],g=out[i+1],bl=out[i+2],al=out[i+3];row += al===0?' .':(al<200?' o':' #');}
      else if(ct===2){row += ' #';}
      else row += (out[i]>200?' #':'.');
    }
    console.log(String(y).padStart(2)+' '+row);
  }
  // corner pixel colors
  const px=(x,y)=>{const i=y*stride+x*bpp;return [out[i],out[i+1],out[i+2],out[i+3]].join(',')};
  console.log('px(0,0)='+px(0,0)+'  px(1,1)='+px(1,1)+'  px(12,12)='+px(12,12)+'  px(2,6)='+px(2,6)+'  px(6,2)='+px(6,2));
}
