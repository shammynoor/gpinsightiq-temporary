export class SupabaseBackend{
 constructor(client){this.client=client;this.demo=false;}
 async rpc(name,args={}){const {data,error}=await this.client.rpc('iq_'+name,args);if(error)throw error;return data;}
 async user(){const {data,error}=await this.client.auth.getUser();if(error)return null;return data.user;}
 async login(email,password){const {error}=await this.client.auth.signInWithPassword({email,password});if(error)throw error;}
 async signup(email,password,redirect){const {data,error}=await this.client.auth.signUp({email,password,options:{emailRedirectTo:redirect}});if(error)throw error;return !!data.session;}
 async logout(){const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;}
 async reset(email,redirect){const {error}=await this.client.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(error)throw error;}
 async password(password){const {error}=await this.client.auth.updateUser({password});if(error)throw error;}
 context(){return this.rpc('my_context');}
 async analyticsSources(practice){const {data,error}=await this.client.from('iq_analytics_sources').select('source_key,kind,source_name,clinical_at,imported_at,row_count,revision').eq('practice_id',practice).order('source_name');if(error)throw error;return data;}
 async analyticsPayload(practice,key){const {data,error}=await this.client.from('iq_analytics_sources').select('payload').eq('practice_id',practice).eq('source_key',key).single();if(error)throw error;return data.payload;}
 async analyticsSettings(practice){const {data,error}=await this.client.from('iq_analytics_settings').select('settings,revision').eq('practice_id',practice).maybeSingle();if(error)throw error;return data||{settings:null,revision:0};}
 saveAnalyticsSource(practice,source){return this.rpc('save_analytics_source',{p_practice:practice,p_key:source.source_key,p_kind:source.kind,p_name:source.source_name,p_clinical:source.clinical_at,p_count:source.row_count,p_payload:source.payload,p_expected:source.revision||0});}
 deleteAnalyticsSource(practice,key,revision){return this.rpc('delete_analytics_source',{p_practice:practice,p_key:key,p_expected:revision});}
 saveAnalyticsSettings(practice,settings,revision){return this.rpc('save_analytics_settings',{p_practice:practice,p_settings:settings,p_expected:revision});}
 claimPlatformAdmin(){return this.rpc('claim_platform_admin');}
 createPractice(name,tenant){return this.rpc('create_practice',{p_name:name,p_tenant_name:tenant});}
 async invite(practice,email,role){
  const {data,error}=await this.client.functions.invoke('iq-send-invite',{body:{practice,email,role}});
  if(error){let message='Invitation email could not be submitted. No successful send was confirmed.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error;}catch{}throw Error(message);}
  if(!data?.email_submitted)throw Error('The email service did not confirm submission.');
  return data;
 }
 redeem(token){return this.rpc('redeem_invite',{p_token:token});}
 members(practice){return this.rpc('list_members',{p_practice:practice});}
 setStatus(practice,user,status){return this.rpc('set_member_status',{p_practice:practice,p_user:user,p_status:status});}
 importRH(practice,bundle,name){return this.rpc('import_rh',{p_practice:practice,p_tenant:bundle.tenant,p_source:name.slice(0,200),p_rows:bundle.rows});}
 async report(practice){
  const stateResult=await this.client.from('iq_rh_state').select('*').eq('practice_id',practice).maybeSingle();if(stateResult.error)throw stateResult.error;
  const daily=[];let from=0;
  while(true){
   const {data,error}=await this.client.from('iq_rh_daily').select('request_date,other_enquiries').eq('practice_id',practice).order('request_date').range(from,from+999);
   if(error)throw error;daily.push(...data);if(data.length<1000)break;from+=1000;
  }
  const result=await this.client.from('iq_rh_imports').select('source_name,imported_at,added,skipped').eq('practice_id',practice).order('imported_at',{ascending:false}).limit(8);if(result.error)throw result.error;
  return {state:stateResult.data,daily,imports:result.data};
 }
}
