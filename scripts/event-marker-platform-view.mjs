import { posix } from 'node:path';
const must=(v,r)=>{if(!v)throw Error('marker_view_'+r);};
const absolute=p=>typeof p==='string'&&p.startsWith('/')&&!p.split('/').includes('..')&&!p.includes('\0');
const under=(p,base)=>base==='/'||p===base||p.startsWith(base+'/');
export function validateViewRules(view){
 must(Array.isArray(view?.mounts)&&view.mounts.length>0&&view.mounts.length<=128&&new Set(view.mounts.map(m=>m.mount)).size===view.mounts.length,'rules');
 for(const m of view.mounts)must(absolute(m.mount)&&typeof m.filesystem==='string'&&m.filesystem.length<=64&&['exact','suffix','controller-context','ecs-task-cgroup','ecs-task-file'].includes(m.root?.kind)&&Array.isArray(m.options)&&m.options.length>0&&m.options.every(v=>typeof v==='string')&&typeof m.required==='boolean'&&(['exact','suffix'].includes(m.root.kind)?absolute(m.root.value):m.root.kind==='controller-context'?m.mount==='/run/vrdex-native/context.json':m.root.kind==='ecs-task-cgroup'?m.filesystem==='cgroup'&&/^\/sys\/fs\/cgroup\/[a-z_,]+$/.test(m.mount):m.filesystem==='ext4'&&['/etc/hosts','/etc/hostname','/etc/resolv.conf'].includes(m.mount))&&(m.source===null||typeof m.source==='string'),'mount_rule');
 must(Array.isArray(view.materialMappings)&&view.materialMappings.length>0&&view.materialMappings.length<=32&&view.materialMappings.every(m=>absolute(m.prefix)&&absolute(m.mount)&&view.mounts.some(r=>r.mount===m.mount)),'material_rules');return view;
}
export function validateMountView(raw,view,transport){
 validateViewRules(view);must(raw.length>0&&raw.length<=65536,'bound');const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);must(text.endsWith('\n'),'syntax');const lines=text.trimEnd().split('\n');must(lines.length<=128,'count');
 const unescape=s=>{must(!/\\(?!040|011|012|134)/.test(s),'escape');return s.replace(/\\(040|011|012|134)/g,(_,n)=>String.fromCharCode(parseInt(n,8)));};
 const rows=lines.map(line=>{const at=line.indexOf(' - ');must(at>0,'syntax');const l=line.slice(0,at).split(' '),r=line.slice(at+3).split(' ');must(l.length>=6&&r.length===3&&/^\d+$/.test(l[0])&&/^\d+$/.test(l[1])&&/^[0-9]+:[0-9]+$/.test(l[2]),'syntax');return {id:l[0],parent:l[1],device:l[2],root:unescape(l[3]),mount:unescape(l[4]),options:l[5].split(','),filesystem:r[0],source:unescape(r[1]),superOptions:r[2]};});
 must(new Set(rows.map(r=>r.id)).size===rows.length&&new Set(rows.map(r=>r.mount)).size===rows.length,'duplicate');
 for(const r of rows){const rule=view.mounts.find(m=>m.mount===r.mount);must(rule&&r.filesystem===rule.filesystem&&rule.options.every(o=>r.options.includes(o))&&(rule.source===null||rule.source===r.source),'unapproved_mount');
  if(rule.root.kind==='exact')must(r.root===rule.root.value,'root');else if(rule.root.kind==='suffix')must(r.root.endsWith(rule.root.value)&&absolute(r.root),'root');else if(rule.root.kind==='ecs-task-cgroup'){const match=/^\/ecs\/([a-f0-9]{32})\/(\1-[0-9]{1,20})$/.exec(r.root);must(match,'ecs_cgroup_root');r.ecsTaskId=match[1];r.ecsContainerId=match[2];}else if(rule.root.kind==='ecs-task-file'){const match=/^\/volumes\/([a-f0-9]{32})\/volumes\/vf-[0-9]{1,20}\/(hosts|hostname|resolv\.conf)$/.exec(r.root);must(match&&'/etc/'+match[2]===r.mount,'ecs_file_root');r.ecsTaskId=match[1];}else must(transport?.kind==='file'&&transport.path===r.mount&&absolute(transport.hostPath)&&r.root===transport.hostPath&&r.options.includes('ro'),'context_mount');
 }
 const tasks=new Set(rows.filter(r=>r.ecsTaskId).map(r=>r.ecsTaskId)),containers=new Set(rows.filter(r=>r.ecsContainerId).map(r=>r.ecsContainerId));must(tasks.size<=1&&containers.size<=1,'ecs_identity');
 for(const rule of view.mounts)must(!rule.required||rows.some(r=>r.mount===rule.mount),'missing_mount');must(rows.some(r=>r.mount==='/'&&r.root==='/'&&r.filesystem==='overlay'),'root_overlay');return rows;
}
export function assertMaterialPath(path,rows,view){const rule=view.materialMappings.filter(r=>under(path,r.prefix)).sort((a,b)=>b.prefix.length-a.prefix.length)[0],actual=rows.filter(r=>under(path,r.mount)).sort((a,b)=>b.mount.length-a.mount.length)[0];must(rule&&actual&&actual.mount===rule.mount,'material_mount');return actual;}
export function assertCatalogAlias(path,object){
 must(object.aliases.includes(path)||path===object.path,'alias');let current=path;const used=new Set();
 while(current!==object.path){const link=object.links.filter(l=>under(current,l.path)).sort((a,b)=>b.path.length-a.path.length)[0];must(link&&!used.has(link.path)&&used.size<16,'alias_relation');used.add(link.path);current=posix.normalize(posix.resolve(posix.dirname(link.path),link.target)+current.slice(link.path.length));}
 return true;
}
