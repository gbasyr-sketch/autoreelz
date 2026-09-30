export {};
const navigation=document.querySelector<HTMLElement>('.product-tabs');
const page=document.querySelector<HTMLElement>('.product-page');
if(navigation&&page){
 const sections=[...navigation.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap(link=>{
  const section=document.getElementById(link.hash.slice(1));return section?[{link,section}]:[];
 });
 let scheduled=false,height=0,current:HTMLAnchorElement|undefined;
 let anchored:((typeof sections)[number]&{y:number})|undefined;
 function update(){
  scheduled=false;
  const bar=navigation!.getBoundingClientRect();
  if(height!==bar.height){height=bar.height;page!.style.setProperty('--product-tabs-height',`${height}px`);}
  const threshold=bar.height+48;
  let active=sections[0];
  for(const entry of sections)if(entry.section.getBoundingClientRect().top<=threshold)active=entry;
  // The last section can be too short to reach the top of the viewport.
  if(scrollY+innerHeight>=document.documentElement.scrollHeight-1&&bar.top<=1)active=sections.at(-1)??active;
  // Preserve the explicitly selected anchor when the browser clamps its scroll at the page end.
  if(anchored&&Math.abs(anchored.y-scrollY)<1)active=anchored;else anchored=undefined;
  if(!active||active.link===current)return;
  current=active.link;
  for(const {link} of sections){if(link===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
  const item=current.getBoundingClientRect();
  if(item.left<bar.left||item.right>bar.right)navigation!.scrollBy({left:item.left-bar.left-(bar.width-item.width)/2,behavior:'instant'});
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
 function rememberAnchor(){requestAnimationFrame(()=>{const entry=sections.find(({link})=>link.hash===location.hash);anchored=entry?{...entry,y:scrollY}:undefined;schedule();});}
 navigation.addEventListener('click',event=>{if(event.button||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;if((event.target as Element).closest('a'))rememberAnchor();});
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',()=>{anchored=undefined;schedule();});
 window.addEventListener('hashchange',rememberAnchor);
 window.addEventListener('pageshow',schedule);
 new ResizeObserver(schedule).observe(page);
 document.fonts.ready.then(schedule);
 schedule();
}
