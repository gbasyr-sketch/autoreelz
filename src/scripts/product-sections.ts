export {};
const navigation=document.querySelector<HTMLElement>('.product-tabs');
const page=document.querySelector<HTMLElement>('.product-page');
if(navigation&&page){
 const sections=[...navigation.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].flatMap(link=>{
  const section=document.getElementById(link.hash.slice(1));return section?[{link,section}]:[];
 });
 let scheduled=false,height=0,current:HTMLAnchorElement|undefined;
 function update(){
  scheduled=false;
  const bar=navigation!.getBoundingClientRect();
  if(height!==bar.height){height=bar.height;page!.style.setProperty('--product-tabs-height',`${height}px`);}
  const threshold=bar.height+48;
  let active=sections[0];
  for(const entry of sections)if(entry.section.getBoundingClientRect().top<=threshold)active=entry;
  // The last section can be too short to reach the top of the viewport.
  if(page!.getBoundingClientRect().bottom<=window.innerHeight&&bar.top<=1)active=sections.at(-1)??active;
  if(!active||active.link===current)return;
  current=active.link;
  for(const {link} of sections){if(link===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
  const item=current.getBoundingClientRect();
  if(item.left<bar.left||item.right>bar.right)navigation!.scrollBy({left:item.left-bar.left-(bar.width-item.width)/2,behavior:'instant'});
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule);
 window.addEventListener('hashchange',schedule);
 window.addEventListener('pageshow',schedule);
 new ResizeObserver(schedule).observe(page);
 document.fonts.ready.then(schedule);
 schedule();
}
