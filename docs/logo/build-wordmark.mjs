// Builds the Oberth wordmark and lockups as outlines, so they need no font installed.
// Needs Jost and opentype.js, kept out of the project's dependencies:
//   npm i --prefix <somewhere> opentype.js @fontsource/jost
//   JOST_DIR=<somewhere>/node_modules node docs/logo/build-wordmark.mjs
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const NM=process.env.JOST_DIR;
const opentype=createRequire(NM+'/')('opentype.js');
const load=w=>{const b=readFileSync(`${NM}/@fontsource/jost/files/jost-latin-${w}-normal.woff`);return opentype.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};
const J700=load(700),J500=load(500),J400=load(400);
const f=n=>+n.toFixed(2),EM=100;
// opentype's own toPathData emits NaN for some points, so the commands are written out here
const pd=p=>p.commands.map(c=>c.type=='Z'?'Z':c.type=='Q'?`Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`:c.type=='C'?`C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`:`${c.type}${f(c.x)} ${f(c.y)}`).join('');
const bb=p=>{const X=[],Y=[];for(const c of p.commands){for(const k of ['x','x1','x2'])if(c[k]!=null)X.push(c[k]);for(const k of ['y','y1','y2'])if(c[k]!=null)Y.push(c[k])}return{x1:Math.min(...X),x2:Math.max(...X),y1:Math.min(...Y),y2:Math.max(...Y)}};
const circ=(x,y,r)=>`M${f(x-r)} ${f(y)}a${r} ${r} 0 1 0 ${f(2*r)} 0a${r} ${r} 0 1 0 ${f(-2*r)} 0z`;
const ink=(font,t,size)=>bb(font.getPath(t,0,0,size,{kerning:true}));
// the mark, sized to Jost's real O and sitting on its baseline
const O=ink(J700,'O',EM),H=O.y2-O.y1,adv=J700.getAdvanceWidth('O',EM),GAP=Math.max(EM*.035,(adv-(O.x2-O.x1))/2);
function mark(x,y,h,ink){const s=h/32,hole=9.6*s,R=16*s,c=[x+R,y+R],thin=Math.max(1.8,(16-9.6)*.42)*s,off=R-hole-thin,u=.7071,ic=[c[0]+off*u,c[1]+off*u],dr=Math.min(4.2,9.6*.42)*s,d=hole-1.5*s-dr,q=[ic[0]+u*d,ic[1]+u*d];
 return `<path fill="${ink}" fill-rule="evenodd" d="${circ(c[0],c[1],R)}${circ(ic[0],ic[1],hole)}"/><circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f(dr)}" fill="#2fb344"/>`}
const BASE=-O.y1; // baseline, with the top of the O at y=0
const bx=H+GAP,bPath=J700.getPath('berth',bx,BASE,EM,{kerning:true}),bBox=bb(bPath);
const WORD_W=bBox.x2,TOP=Math.min(0,bBox.y1),BOT=Math.max(H,bBox.y2);
const word=c=>mark(0,0,H,c)+`<path fill="${c}" d="${pd(bPath)}"/>`;
const svg=(x,y,w,h,body,title)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
// capitals tracked so their ink spans exactly the width of the word
function caps(y,size,c){const t='DEV PROJECT CONSOLE',g=[...t],adv=g.map(ch=>J500.getAdvanceWidth(ch,size)),first=ink(J500,'D',size),last=ink(J500,'E',size),lastRsb=adv.at(-1)-last.x2,natural=adv.reduce((a,b)=>a+b,0)-first.x1-lastRsb,track=(WORD_W-natural)/(g.length-1);let x=-first.x1,d='',low=y;g.forEach((ch,i)=>{const p=J500.getPath(ch,x,y,size);d+=pd(p);low=Math.max(low,bb(p).y2);x+=adv[i]+track});return {body:`<path fill="${c}" fill-opacity=".72" d="${d}"/>`,low}}
function wide(c){const gap=EM*.28,rx=WORD_W+gap,tx=rx+gap,size=EM*.34,lead=size*1.15,mid=(TOP+BOT)/2,cap=ink(J400,'D',size),capH=cap.y2-cap.y1,y1=mid-(lead+capH)/2+capH,y2=y1+lead,a=J400.getPath('Dev Project',tx,y1,size,{kerning:true}),b=J400.getPath('Console',tx,y2,size,{kerning:true}),A=bb(a),B=bb(b);return {body:`<rect x="${f(rx)}" y="${f(mid-EM*.4)}" width="1.1" height="${f(EM*.8)}" fill="${c}" fill-opacity=".45"/><path fill="${c}" fill-opacity=".72" d="${pd(a)}${pd(b)}"/>`,w:Math.max(A.x2,B.x2),top:Math.min(TOP,A.y1),bot:Math.max(BOT,B.y2,A.y2)}}
const here=n=>new URL(n,import.meta.url);
for(const [suffix,c] of [['','#222222'],['-on-dark','#eeeeee']]){
 writeFileSync(here(`oberth-wordmark${suffix}.svg`),svg(0,TOP,WORD_W,BOT-TOP,word(c),'Oberth'));
 const size=EM*.2,y=BOT+EM*.16+EM*.145;
 const k=caps(y,size,c);writeFileSync(here(`oberth-lockup${suffix}.svg`),svg(0,TOP,WORD_W,k.low-TOP,word(c)+k.body,'Oberth Dev Project Console'));
 const w=wide(c);writeFileSync(here(`oberth-lockup-wide${suffix}.svg`),svg(0,w.top,w.w,w.bot-w.top,word(c)+w.body,'Oberth Dev Project Console'));
}
console.log({H:f(H),GAP:f(GAP),WORD_W:f(WORD_W),TOP:f(TOP),BOT:f(BOT)});
