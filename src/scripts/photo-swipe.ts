/** Horizontal, single-finger gestures; the browser owns vertical scrolling and pinch zoom. */
export function photoSwipe(surface:HTMLElement,step:(direction:number)=>void){
 const pointers=new Set<number>();
 let gesture:{id:number;x:number;y:number;at:number;vertical:boolean}|undefined,blockClickUntil=0;
 const zoomed=()=>!!window.visualViewport&&window.visualViewport.scale>1.01;
 const reset=()=>{gesture=undefined;pointers.clear();};
 const updateZoom=()=>{surface.toggleAttribute('data-gallery-zoomed',zoomed());if(zoomed())reset();};
 surface.setAttribute('data-gallery-swipe','');updateZoom();
 surface.addEventListener('pointerdown',event=>{
  if(event.pointerType!=='touch')return;
  pointers.add(event.pointerId);
  if(pointers.size!==1||!event.isPrimary){gesture=undefined;blockClickUntil=performance.now()+700;return;}
  blockClickUntil=0;
  if(zoomed()||(event.target as Element).closest('button,a')){gesture=undefined;return;}
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),vertical:false};
 },{passive:true});
 surface.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=Math.abs(event.clientX-gesture.x),dy=Math.abs(event.clientY-gesture.y);
  if(dx>10||dy>10)blockClickUntil=performance.now()+700;
  if(dy>10&&dy>dx)gesture.vertical=true;
 },{passive:true});
 surface.addEventListener('pointerup',event=>{
  const start=gesture;gesture=undefined;
  if(start&&start.id===event.pointerId&&pointers.size===1&&!start.vertical&&!zoomed()){
   const dx=event.clientX-start.x,dy=event.clientY-start.y;
   if(Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.5&&performance.now()-start.at<1500){blockClickUntil=performance.now()+700;step(dx<0?1:-1);}
  }
  pointers.delete(event.pointerId);
 },{passive:true});
 surface.addEventListener('pointercancel',event=>{gesture=undefined;pointers.delete(event.pointerId);},{passive:true});
 surface.addEventListener('click',event=>{if(event.detail>0&&performance.now()<blockClickUntil){event.preventDefault();event.stopImmediatePropagation();blockClickUntil=0;}},true);
 window.visualViewport?.addEventListener('resize',updateZoom);
 window.addEventListener('blur',reset);
 return reset;
}
