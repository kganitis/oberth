// Builds docs/logo/oberth-emblem.svg, the large Oberth emblem. Run: node docs/logo/build-emblem.mjs
import {writeFileSync} from 'node:fs';
const f=n=>+n.toFixed(2),rad=d=>d*Math.PI/180,dirv=a=>[Math.sin(rad(a)),-Math.cos(rad(a))];
const circ=(x,y,r)=>`M${f(x-r)} ${f(y)}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0z`;
const F=(d,c)=>`<path fill="${c}" fill-rule="evenodd" d="${d}"/>`,S=(d,w,c)=>`<path fill="none" stroke="${c}" stroke-width="${w}" d="${d}"/>`;
const poly=(p,fill,op=1)=>`<path fill="${fill}"${op<1?` fill-opacity="${op}"`:''} d="M${p.map(q=>f(q[0])+' '+f(q[1])).join('L')}z"/>`;
const pol=(x,y,r,a)=>{const v=dirv(a);return [x+v[0]*r,y+v[1]*r]};
const U=dirv(135),R=46,r=28,OFF=9.5,IC=[64+U[0]*OFF,64+U[1]*OFF],LR=9.8,Q=[IC[0]+U[0]*15.3,IC[1]+U[1]*15.3],[x,y]=Q;
const GOLD=['#fff0bd','#f3d78a','#bd9440','#7d5f22'],GROUND='#0b1330',BAND='#101a3f',METAL='#f3d78a',DEEP='#8a6a24';
const ring=t=>({x:IC[0]+(64-IC[0])*t,y:IC[1]+(64-IC[1])*t,r:r+(R-r)*t});
const thick=th=>(R-r-OFF*Math.cos(rad(th-135)))/(R-r+OFF);
// lattice line: amplitude follows the local thickness of the O, so the thin side stays open
const lattice=(c,ph)=>{const a=[];for(let i=0;i<=480;i++){const t=i/480*2*Math.PI,comp=(t*180/Math.PI+90)%360,amp=2.5*Math.max(.12,thick(comp)),q=c.r+amp*Math.sin(15*t+ph);a.push(f(c.x+q*Math.cos(t))+' '+f(c.y+q*Math.sin(t)))}return 'M'+a.join('L')+'z'};
const star=(sx,sy,s)=>`<path fill="${METAL}" d="M${f(sx)} ${f(sy-s)}Q${f(sx+s*.14)} ${f(sy-s*.14)} ${f(sx+s)} ${f(sy)}Q${f(sx+s*.14)} ${f(sy+s*.14)} ${f(sx)} ${f(sy+s)}Q${f(sx-s*.14)} ${f(sy+s*.14)} ${f(sx-s)} ${f(sy)}Q${f(sx-s*.14)} ${f(sy-s*.14)} ${f(sx)} ${f(sy-s)}z"/>`;
let defs=`<linearGradient id="ob-rim" x1="18" y1="18" x2="110" y2="110" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff0bd"/><stop offset=".5" stop-color="#f3d78a"/><stop offset="1" stop-color="#bd9440"/></linearGradient>
<radialGradient id="ob-enamel" cx="${f(x)}" cy="${f(y)}" r="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f4582c"/><stop offset=".55" stop-color="#e2471f"/><stop offset="1" stop-color="#cf3d18"/></radialGradient>
<radialGradient id="ob-glow" cx="${f(x)}" cy="${f(y)}" r="29" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7dff8f" stop-opacity=".85"/><stop offset=".55" stop-color="#3fd05a" stop-opacity=".3"/><stop offset="1" stop-color="#3fd05a" stop-opacity="0"/></radialGradient>
<radialGradient id="ob-lens" cx="${f(x)}" cy="${f(y)}" r="${f(LR*1.02)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f4ffd8"/><stop offset=".18" stop-color="#c8ff9a"/><stop offset=".45" stop-color="#5fe777"/><stop offset=".75" stop-color="#2fb344"/><stop offset="1" stop-color="#17792e"/></radialGradient>
<radialGradient id="ob-hot" cx="${f(x)}" cy="${f(y)}" r="${f(LR*.62)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fffde0" stop-opacity=".95"/><stop offset=".45" stop-color="#d8ff9e" stop-opacity=".55"/><stop offset="1" stop-color="#8dff8a" stop-opacity="0"/></radialGradient>
<radialGradient id="ob-sheen" cx="${f(x-3.6)}" cy="${f(y-3.8)}" r="3.6" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="ob-body"><path clip-rule="evenodd" d="${circ(64,64,R)}${circ(IC[0],IC[1],r)}"/></clipPath>
<clipPath id="ob-field"><circle cx="${f(IC[0])}" cy="${f(IC[1])}" r="${f(r-1.1)}"/></clipPath>
<clipPath id="ob-lensclip"><circle cx="${f(x)}" cy="${f(y)}" r="${LR}"/></clipPath>`;
let o=F(circ(64,64,63.6),'url(#ob-rim)')+F(circ(64,64,61),DEEP)+F(circ(64,64,60.2),GROUND)+F(circ(64,64,50.6),BAND)+S(circ(64,64,50.6),.7,METAL);
for(let t=0;t<120;t++){const big=t%10==0,mid=t%5==0,A=pol(64,64,50.9,t*3),B=pol(64,64,big?59.9:mid?57.4:55,t*3);o+=`<path stroke="${big?METAL:'#d9b969'}" stroke-width="${big?1.2:.6}" d="M${f(A[0])} ${f(A[1])}L${f(B[0])} ${f(B[1])}"/>`}
o+=F(circ(64,64,R)+circ(IC[0],IC[1],r),'url(#ob-enamel)')+'<g clip-path="url(#ob-body)">';
for(let k=1;k<6;k++)o+=S(lattice(ring(k/6),k%2?Math.PI:0),1,METAL);
o+='</g>'+F(circ(IC[0],IC[1],r),'#16245a')+`<circle cx="${f(x)}" cy="${f(y)}" r="29" fill="url(#ob-glow)" clip-path="url(#ob-field)"/>`;
o+='<g clip-path="url(#ob-field)">';for(let i=0;i<16;i++){const a=i*22.5,A=pol(x,y,LR+6.2,a),B=pol(x,y,LR+6.2,a+11.25),m=a+5.625,v=dirv(m),dx=x-IC[0],dy=y-IC[1],bq=dx*v[0]+dy*v[1],cq=dx*dx+dy*dy-(r-2.8)**2,room=-bq+Math.sqrt(bq*bq-cq),len=Math.min(LR+(i%2?10.5:15),room);if(len<LR+8.2)continue;const T=pol(x,y,len,m);o+=poly([A,T,B],i%2?'#ff8a5c':METAL)}o+='</g>';
o+=S(circ(64,64,R),2.2,METAL)+S(circ(IC[0],IC[1],r),2.2,METAL);
[[-15.2,-10.2,4.2],[-7.2,-18.2,2.4],[-19.2,-.7,2]].forEach(([a,b,s])=>o+=star(IC[0]+a,IC[1]+b,s));
const rot=15,size=5.6,out=[0,1,2,3,4,5].map(i=>pol(x,y,LR+size,i*60+rot)),inn=[0,1,2,3,4,5].map(i=>pol(x,y,LR+size-2,i*60+rot));
o+=poly(out.map(q=>[q[0]+.9,q[1]+1.1]),'#050a1c',.5);
for(let i=0;i<6;i++){const a=i*60+rot+30,lit=Math.cos(rad(a-315));o+=poly([out[i],out[(i+1)%6],inn[(i+1)%6],inn[i]],lit>.5?GOLD[0]:lit>-.2?GOLD[1]:lit>-.75?GOLD[2]:GOLD[3])}
o+=poly(inn,GOLD[1])+F(circ(x,y,LR+1.9),GOLD[3])+F(circ(x,y,LR+1.25),GOLD[0])+F(circ(x,y,LR+.7),'#0a1a12');
o+=`<circle cx="${f(x)}" cy="${f(y)}" r="${LR}" fill="url(#ob-lens)"/><g clip-path="url(#ob-lensclip)">`;
const s=LR/2.6*1.25*.5,h=LR/2.6*.62;for(let i=-5;i<=5;i++)for(let j=-5;j<=5;j++){const cx=x+(i+j)*s,cy=y+(i-j)*s;if(Math.hypot(cx-x,cy-y)>LR+h)continue;const T=[cx,cy-h],Rr=[cx+h,cy],B=[cx,cy+h],L=[cx-h,cy],M=[cx,cy];o+=poly([T,Rr,M],'#fff',.2)+poly([Rr,B,M],'#04351a',.22)+poly([B,L,M],'#04351a',.1)+poly([L,T,M],'#fff',.1)}
o+=`</g><circle cx="${f(x)}" cy="${f(y)}" r="${f(LR*.62)}" fill="url(#ob-hot)"/><circle cx="${f(x-3.6)}" cy="${f(y-3.8)}" r="3.6" fill="url(#ob-sheen)"/>`;
writeFileSync(new URL('oberth-emblem.svg',import.meta.url),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Oberth emblem"><title>Oberth</title><defs>${defs}</defs>${o}</svg>\n`);
