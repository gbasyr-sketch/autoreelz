// Only public media URLs are transformed; SVG, remote and private editor URLs stay intact.
export const imageWidths=[160,320,480,640,960,1280] as const;
export function imageWidth(value:string|null):number|null {
 if(value===null)return null;
 return imageWidths.find(width=>String(width)===value)??null;
}
const publicMedia=/^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function responsiveImage(src:string|undefined,sizes:string,widths:readonly number[]=imageWidths){
 if(!src||!publicMedia.test(src))return{};
 return{srcset:widths.map(width=>`${src}?w=${width} ${width}w`).join(', '),sizes};
}
export const cardImageSizes='(max-width: 600px) calc((100vw - 48px) / 2), (max-width: 1000px) 30vw, 320px';
export const productImageSizes='(max-width: 600px) calc(100vw - 32px), (max-width: 800px) calc((100vw - 54px) / 2), (max-width: 1100px) calc((100vw - 78px) * 1.1 / 2.1), min(698px, calc((100vw - 128px) * 1.2 / 2.2))';
