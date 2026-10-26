// Backend aislado de la copia. Los archivos del catálogo siguen sirviéndose como assets.
const encoder=new TextEncoder();
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function json(data,status=200){return Response.json(data,{status,headers:{'cache-control':'no-store'}});}
export function cleanEdit(raw){
  const codigo=String(raw.codigo??raw.idart??'').trim();
  if(!/^\d{1,12}$/.test(codigo))throw fail('Código de artículo inválido.');
  const number=(name,alias,max=1e9)=>{const value=Number(raw[name]??raw[alias]??0);if(!Number.isFinite(value)||value<0||value>max)throw fail('Valor de artículo inválido.');return value;};
  const images=[...new Set((raw.imagenes||[]).map(String))];
  if(images.length>20||images.some(url=>{try{return new URL(url).protocol!=='https:'||url.length>2048}catch{return true}}))throw fail('Usá hasta veinte fotos con dirección HTTPS.');
  const date=String(raw.ofertaHasta??raw.oferta_hasta??'');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw fail('Fecha de oferta inválida.');
  const tags=raw.tagsOcultos??raw.tags_ocultos??[];
  if(!Array.isArray(tags)||tags.length>100)throw fail('Etiquetas inválidas.');
  return {codigo,detalle:String(raw.detalle||'').slice(0,12000),tags_ocultos:tags.map(tag=>String(tag).slice(0,200)),foto_url:images[0]||'',imagenes:images,
    oferta:!!raw.oferta,oferta_pct:number('ofertaPct','oferta_pct',100),oferta_hasta:date,destacado:!!raw.destacado,mas_vendido:!!(raw.masVendido??raw.mas_vendido),
    acceso_rapido:!!(raw.accesoRapido??raw.acceso_rapido),ceramico:!!raw.ceramico,ceramico_m2:number('ceramicoM2','ceramico_m2'),ceramico_placas:number('ceramicoPlacas','ceramico_placas'),edicion_updated_at:new Date().toISOString()};
}
function firestoreValue(field){if(!field)return null;if('arrayValue'in field)return(field.arrayValue.values||[]).map(firestoreValue);return field.stringValue??field.booleanValue??field.integerValue??null;}
export async function menuUser(id){
  if(!id||id.length>160)throw fail('Sesión inválida.',401);
  const response=await fetch('https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/'+encodeURIComponent(id)+'?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw fail('No se pudo verificar el usuario en el Menú.',response.status===404?401:503);
  const fields=(await response.json()).fields||{},user={id};for(const [key,value]of Object.entries(fields))user[key]=firestoreValue(value);
  if(!user.password)throw fail('Usuario sin una clave válida.',401);return user;
}
export class IndexTestStore {
  constructor(ctx){this.ctx=ctx;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');}
  get(key){return this.sql.exec('SELECT value FROM state WHERE key=?',key).toArray().map(row=>JSON.parse(row.value))[0];}
  put(key,value){this.sql.exec('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
  list(prefix){return this.sql.exec('SELECT key,value FROM state WHERE key>=? AND key<? ORDER BY key',prefix,prefix+'\uffff').toArray().map(row=>({key:row.key,value:JSON.parse(row.value)}));}
  async fetch(request){
    const {op,data={}}=await request.json();
    try{
      let result;
      this.ctx.storage.transactionSync(()=>{
        if(op==='get')result=this.get(data.key)||null;
        else if(op==='put'){this.put(data.key,data.value);result={ok:true};}
        else if(op==='rate'){
          const bucket=Math.floor(Date.now()/600000),key='rate:'+data.key;
          let state=this.get(key);if(!state||state.bucket!==bucket)state={bucket,count:0};
          if(state.count>=data.max)throw fail('Demasiados intentos. Reintentá más tarde.',429);state.count++;this.put(key,state);result={ok:true};
        }else if(op==='edits'){
          const revision=Number(this.get('revision')||0)+1;
          for(const entry of data.articles){const previous=this.get('edit:'+entry.article.codigo);if(Number(entry.expected||0)!==Number(previous?.revision||0))throw fail('Otro equipo cambió este artículo. Actualizá la lista antes de guardar.',409);}
          for(const entry of data.articles)this.put('edit:'+entry.article.codigo,{...entry.article,revision,updated_by:data.user});
          this.put('revision',revision);result={ok:true,version:revision,edits:data.articles.map(entry=>this.get('edit:'+entry.article.codigo))};
        }else if(op==='export')result={revision:this.get('revision')||0,edits:this.list('edit:').map(entry=>entry.value),aridos:this.list('arido:').map(entry=>entry.value),freight:this.get('freight')||null};
        else if(op==='config'){
          this.put(data.key,data.value);this.put('revision',Number(this.get('revision')||0)+1);result={ok:true};
        }else if(op==='reserve'){
          const key='request:'+data.requestId,previous=this.get(key);
          if(previous){result=previous;return;}
          const number=Number(this.get('budget-number')||0)+1;this.put('budget-number',number);
          result={numero_completo:'PRUEBA-0001-'+String(number).padStart(8,'0'),claim:data.claim};
          this.put(key,result);this.put('claim:'+result.numero_completo,{hash:data.hash,expires:Date.now()+86400000});
        }else if(op==='budget'){
          const claim=this.get('claim:'+data.record.numero);
          if(!claim||claim.hash!==data.hash)throw fail('No se puede guardar este presupuesto.',403);
          const key='budget:'+data.record.numero,previous=this.get(key);
          if(previous){if(previous.hash!==data.payloadHash)throw fail('El presupuesto ya existe con otros datos.',409);result={ok:true,numero:data.record.numero};return;}
          if(claim.expires<Date.now())throw fail('La reserva de número venció. Generá otro presupuesto.',409);
          this.put(key,{record:data.record,hash:data.payloadHash});result={ok:true,numero:data.record.numero};
        }else if(op==='import-budgets'){
          for(const record of data.records){const key='budget:'+record.numero;if(!this.get(key))this.put(key,{record,hash:'importado'});}result={ok:true};
        }else if(op==='search-budgets'){
          const words=normalize(data.query).split(/\s+/).filter(Boolean);
          result=this.list('budget:').map(entry=>entry.value.record).filter(record=>{
            const date=String(record.fecha_iso||'').slice(0,10);
            if(data.from&&date<data.from||data.to&&date>data.to)return false;
            return(record.items||[]).some(item=>{const text=normalize([item.codigo,item.nombre,item.descripcion].join(' '));return words.every(word=>text.includes(word));});
          }).sort((a,b)=>String(b.fecha_iso).localeCompare(String(a.fecha_iso))).slice(0,100);
        }else throw fail('Operación no válida.',404);
      });return json(result);
    }catch(error){return json({ok:false,error:error.message},error.status||500);}
  }
}
async function call(env,op,data){const response=await env.INDEX_STATE.getByName('prueba').fetch(new Request('https://state/',{method:'POST',body:JSON.stringify({op,data})}));const result=await response.json();if(!response.ok)throw fail(result.error,response.status);return result;}
async function body(request,max=1500000){if(Number(request.headers.get('content-length'))>max)throw fail('El envío es demasiado grande.',413);const reader=request.body?.getReader();if(!reader)return{};const parts=[];let length=0;while(true){const{done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw fail('El envío es demasiado grande.',413);}parts.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw fail('JSON inválido.');}}
async function authenticate(request,env){
  const raw=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
  if(!raw)throw fail('Iniciá sesión desde el Menú para usar esta función.',401);
  const session=await call(env,'get',{key:'session:'+await digest(raw)});
  if(!session||session.expires<Date.now())throw fail('La sesión de la copia venció. Volvé a abrirla desde el Menú.',401);
  const user=await menuUser(session.userId);
  if(await digest(String(user.password))!==session.passwordHash)throw fail('La sesión ya no es válida.',401);
  return {id:user.id,nombre:user.nombre||user.usuario||user.id,nivel:user.nivel};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/index-prueba/'))return env.ASSETS.fetch(request);
    const origin=request.headers.get('origin')||'';
    const allowed=!origin||/^https:\/\/(?:corralonprogreso\.com|www\.corralonprogreso\.com|corralon-index-sql-prueba\.benjaminsuarez002\.workers\.dev)$/.test(origin)||/^https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|100\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/.test(origin);
    if(!allowed)return json({error:'Origen no permitido.'},403);
    const cors=response=>{const headers=new Headers(response.headers);if(origin)headers.set('access-control-allow-origin',origin);headers.set('vary','Origin');headers.set('access-control-allow-headers','authorization,content-type,x-publisher-token');headers.set('access-control-allow-methods','GET,POST,OPTIONS');return new Response(response.body,{status:response.status,headers});};
    if(request.method==='OPTIONS')return cors(new Response(null,{status:204}));
    try{
      const route=url.pathname.slice('/api/index-prueba/'.length),ip=await digest(request.headers.get('cf-connecting-ip')||'local');
      if(route.startsWith('publisher/')){
        const secret=request.headers.get('x-publisher-token');if(!env.PUBLISH_TOKEN||!secret||await digest(secret)!==await digest(env.PUBLISH_TOKEN))throw fail('No autorizado.',401);
        if(route==='publisher/export'&&request.method==='GET')return cors(json(await call(env,'export',{})));
        if(route==='publisher/import-budgets'&&request.method==='POST'){const data=await body(request,3000000);if(!Array.isArray(data.records)||data.records.length>200)throw fail('Lote inválido.');return cors(json(await call(env,'import-budgets',data)));}
        throw fail('Operación no válida.',404);
      }
      if(route==='login'&&request.method==='POST'){
        await call(env,'rate',{key:'login:'+ip,max:30});const data=await body(request,10000),user=await menuUser(String(data.userId||''));
        if(!data.password||await digest(String(data.password))!==await digest(String(user.password)))throw fail('Usuario o clave no válidos.',401);
        const raw=token(),expires=Date.now()+8*3600000;
        await call(env,'put',{key:'session:'+await digest(raw),value:{userId:user.id,passwordHash:await digest(String(user.password)),expires}});
        return cors(json({ok:true,token:raw,expires,user:{id:user.id,nombre:user.nombre||user.usuario,nivel:user.nivel}}));
      }
      if(route==='budget/reserve'&&request.method==='POST'){
        await call(env,'rate',{key:'reserve:'+ip,max:60});const data=await body(request,1000);
        if(!/^[a-zA-Z0-9-]{20,100}$/.test(data.requestId||''))throw fail('Identificador de presupuesto inválido.');
        const claim=token();return cors(json(await call(env,'reserve',{requestId:data.requestId,claim,hash:await digest(claim)})));
      }
      if(route==='budget/save'&&request.method==='POST'){
        const data=await body(request),record=data.record;
        if(!record||!/^PRUEBA-0001-\d{8}$/.test(record.numero)||!Array.isArray(record.items)||record.items.length<1||record.items.length>1000||!Number.isFinite(record.total))throw fail('Presupuesto inválido.');
        let total=0;for(const item of record.items){if(!Number.isFinite(item.cantidad)||item.cantidad<=0||!Number.isFinite(item.precio)||item.precio<0)throw fail('Artículo presupuestado inválido.');total+=item.cantidad*item.precio;}
        if(Math.abs(total-record.total)>.02)throw fail('El total del presupuesto no coincide.');
        return cors(json(await call(env,'budget',{record,hash:await digest(String(data.claim||'')),payloadHash:await digest(JSON.stringify(record))})));
      }
      const user=await authenticate(request,env);
      if(route==='private-key'&&request.method==='GET'){if(!env.CATALOG_COST_KEY)throw fail('Costos aún no publicados.',503);return cors(json({ok:true,key:env.CATALOG_COST_KEY}));}
      if(route==='edits'&&request.method==='POST'){
        const data=await body(request);if(!Array.isArray(data.articles)||!data.articles.length||data.articles.length>500)throw fail('Seleccioná entre uno y quinientos artículos.');
        const articles=data.articles.map(raw=>({article:cleanEdit(raw),expected:Number(raw.sqlEditRevision||0)}));
        if(new Set(articles.map(entry=>entry.article.codigo)).size!==articles.length)throw fail('Artículos duplicados.');
        return cors(json(await call(env,'edits',{articles,user:user.id})));
      }
      if(route==='arido'&&request.method==='POST'){
        const data=await body(request,20000),code=String(data.codigo||'');if(!/^\d{1,12}$/.test(code))throw fail('Artículo inválido.');
        const config=data.config||{},prices=config.precios||{};if(Object.values(prices).some(value=>!Number.isFinite(Number(value))||Number(value)<0))throw fail('Precios de áridos inválidos.');
        return cors(json(await call(env,'config',{key:'arido:'+code,value:{codigo:code,activo:!!config.activo,tipo:String(config.tipo||''),precios:prices}})));
      }
      if(route==='freight'&&request.method==='POST'){
        const data=await body(request,10000);for(const key of['rawson','pasandoCalle5'])if(!Number.isFinite(Number(data[key]))||Number(data[key])<0)throw fail('Flete inválido.');
        return cors(json(await call(env,'config',{key:'freight',value:{idArtFlete:String(data.idArtFlete||'012025'),rawson:Number(data.rawson),pasandoCalle5:Number(data.pasandoCalle5)}})));
      }
      if(route==='budget/search'&&request.method==='POST'){const data=await body(request,10000);return cors(json(await call(env,'search-budgets',{query:String(data.query||'').slice(0,100),from:String(data.from||''),to:String(data.to||'')})));}
      throw fail('Operación no encontrada.',404);
    }catch(error){return cors(json({ok:false,error:error.status?error.message:'No se pudo completar la operación de la copia.'},error.status||500));}
  }
};
