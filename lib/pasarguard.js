const BASE = process.env.PASARGUARD_BASE_URL?.replace(/\/$/, '');
const USERNAME = process.env.PASARGUARD_USERNAME;
const PASSWORD = process.env.PASARGUARD_PASSWORD;
const ACCESS_TOKEN = process.env.PASARGUARD_ACCESS_TOKEN;
let token = ACCESS_TOKEN || null;
let tokenExpiresAt = ACCESS_TOKEN ? Infinity : 0;
class PasarGuardError extends Error { constructor(message,status,operation,transient=false){super(message);this.name='PasarGuardError';this.status=status;this.operation=operation;this.transient=transient;} }
function configured(){return Boolean(BASE&&(token||(USERNAME&&PASSWORD)));}
function safeError(body){if(!body)return'PasarGuard request failed';if(typeof body==='string')return body.slice(0,300);return String(body.detail||body.message||body.error||'PasarGuard request failed').slice(0,300);}
async function authenticate(){if(!BASE||!USERNAME||!PASSWORD)throw new PasarGuardError('PasarGuard credentials are not configured',0,'auth');const form=new URLSearchParams({username:USERNAME,password:PASSWORD});const res=await fetch(`${BASE}/api/admin/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15000)});const text=await res.text();let body;try{body=JSON.parse(text);}catch{body=text;}if(!res.ok||!body?.access_token)throw new PasarGuardError(safeError(body),res.status,'auth',res.status>=500||res.status===429);token=body.access_token;tokenExpiresAt=Date.now()+20*60*1000;return token;}
async function request(method,path,body,operation,attempt=0){if(!BASE)throw new PasarGuardError('PASARGUARD_BASE_URL is not configured',0,operation);if(!token||Date.now()>=tokenExpiresAt)await authenticate();const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};if(body!==undefined)headers['Content-Type']='application/json';let response;try{response=await fetch(`${BASE}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch(err){if(attempt<2){await new Promise(r=>setTimeout(r,400*(2**attempt)));return request(method,path,body,operation,attempt+1);}throw new PasarGuardError('network failure',0,operation,true);}const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data=text;}if(response.status===401&&attempt===0&&!ACCESS_TOKEN){token=null;tokenExpiresAt=0;return request(method,path,body,operation,1);}if(!response.ok){throw new PasarGuardError(safeError(data),response.status,operation,response.status===429||response.status>=500);}return data;}
async function getUserById(id){return request('GET',`/api/user/by-id/${encodeURIComponent(id)}`,undefined,'get_user');}
async function getUserByUsername(username){return request('GET',`/api/user/by-username/${encodeURIComponent(username)}`,undefined,'get_user');}
async function createFromTemplate(templateId,username,note){return request('POST','/api/user/from_template',{user_template_id:templateId,username,note},'create_user');}
async function applyTemplate(username,templateId,note){return request('PUT',`/api/user/${encodeURIComponent(username)}/from_template`,{user_template_id:templateId,note},'apply_template');}
async function modifyUserById(id,patch){return request('PUT',`/api/user/by-id/${encodeURIComponent(id)}`,patch,'modify_user');}
async function disableUserById(id,disabled=true){return modifyUserById(id,{status:disabled?'disabled':'active'});}
async function deleteUserById(id){return request('DELETE',`/api/user/by-id/${encodeURIComponent(id)}`,undefined,'delete_user');}
async function ping(){return request('GET','/api/admin',undefined,'health');}
module.exports={configured,authenticate,request,getUserById,getUserByUsername,createFromTemplate,applyTemplate,modifyUserById,disableUserById,deleteUserById,ping,PasarGuardError};
