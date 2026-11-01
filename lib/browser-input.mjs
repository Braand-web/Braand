// Human input has its own protocol. It is never added to model tool schemas.
const keys=new Set(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Space']);
export function parseHumanBrowserInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('browser_input_invalid');
 const allowed={pointer:['kind','x','y'],text:['kind','text'],key:['kind','key'],scroll:['kind','deltaY']};
 const fields=allowed[value.kind];
 if(!fields||Object.keys(value).some(key=>!fields.includes(key)))throw Error('browser_input_invalid');
 if(value.kind==='pointer'&&(!Number.isInteger(value.x)||!Number.isInteger(value.y)||value.x<0||value.y<0||value.x>16384||value.y>16384))throw Error('browser_input_invalid');
 if(value.kind==='scroll'&&(!Number.isInteger(value.deltaY)||Math.abs(value.deltaY)>10000))throw Error('browser_input_invalid');
 if(value.kind==='text'&&(typeof value.text!=='string'||!value.text.length||value.text.length>4096||!value.text.isWellFormed()||value.text.includes('\0')))throw Error('browser_input_invalid');
 if(value.kind==='key'&&(!keys.has(value.key)))throw Error('browser_input_invalid');
 return {...value};
}
export function browserPoint(rect,clientX,clientY,viewport){
 if(!rect.width||!rect.height||!viewport.width||!viewport.height)throw Error('browser_input_invalid');
 return {x:Math.min(viewport.width-1,Math.max(0,Math.round((clientX-rect.left)/rect.width*viewport.width))),y:Math.min(viewport.height-1,Math.max(0,Math.round((clientY-rect.top)/rect.height*viewport.height)))};
}
