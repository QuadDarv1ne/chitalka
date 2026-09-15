const fs=require('fs');
for(const f of fs.readdirSync('books').filter(x=>/\.mp3\.zip$/i.test(x))){
  const buf=fs.readFileSync('books/'+f); let e=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-66000);i--){if(buf.readUInt32LE(i)===0x06054b50){e=i;break;}}
  const total=buf.readUInt16LE(e+10); let off=buf.readUInt32LE(e+16); let id3=0,n=0,shown=[],badFlag=0;
  for(let k=0;k<total&&k<300;k++){
    if(buf.readUInt32LE(off)!==0x02014b50)break;
    const flags=buf.readUInt16LE(off+8);
    const nl=buf.readUInt16LE(off+28),el=buf.readUInt16LE(off+30),cl=buf.readUInt16LE(off+32),lho=buf.readUInt32LE(off+42);
    const raw=buf.subarray(off+46,off+46+nl); const utf8=(flags&0x800)!==0;
    const nameU8=raw.toString('utf8');
    if(/\.mp3$/i.test(nameU8)){n++;const ds=lho+30+buf.readUInt16LE(lho+26)+buf.readUInt16LE(lho+28);if(buf.subarray(ds,ds+3).toString('latin1')==='ID3')id3++;}
    if(!utf8&&/[^\x20-\x7e]/.test(nameU8))badFlag++;
    if(shown.length<1)shown.push(`     utf8flag=${utf8} asUTF8="${nameU8}"`);
    off+=46+nl+el+cl;
  }
  console.log(`${f.slice(0,45)} | mp3=${n} id3=${id3} namesNotUtf8=${badFlag}`); console.log(shown.join(''));
}
