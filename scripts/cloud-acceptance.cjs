'use strict';
const {createClient}=require('@supabase/supabase-js');
const marker='xiaoyang-six-step-20261104',phones=['+8610000000001','+8610000000002'];
// These 100... test identities are outside China's assigned mobile-number prefixes.
// Admin confirmation creates no SMS; never substitute a real person's phone number.
async function run(action=process.argv[2],env=process.env){
 if(!['setup','cleanup'].includes(action))throw Error('Expected setup or cleanup');
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.ANDROID_ACCEPTANCE_PASSWORD)throw Error('Missing acceptance Secrets');
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options),users=[];
 for(let page=1;page<=20;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:100});if(error)throw error;users.push(...data.users);if(data.users.length<100)break;if(page===20)throw Error('Too many users for bounded acceptance lookup');}
 const owned=users.filter(u=>phones.includes('+'+String(u.phone||'').replace(/^\+/,''))&&u.app_metadata?.xy_acceptance===marker);
 if(action==='cleanup'){
  for(const user of owned){const {error:rows}=await admin.from('user_favorites').delete().eq('user_id',user.id);if(rows)throw rows;const {error}=await admin.auth.admin.deleteUser(user.id);if(error)throw error;}
  console.log(JSON.stringify({action,removedOwnedTestAccounts:owned.length,originalUserAccountsChanged:false}));return;
 }
 const accounts=[];
 for(const phone of phones){const existing=users.find(u=>'+'+String(u.phone||'').replace(/^\+/,'')===phone);if(existing&&existing.app_metadata?.xy_acceptance!==marker)throw Error('Reserved test identity already belongs to an unmarked account; preserved unchanged');
  const result=existing?await admin.auth.admin.updateUserById(existing.id,{password:env.ANDROID_ACCEPTANCE_PASSWORD}):await admin.auth.admin.createUser({phone,password:env.ANDROID_ACCEPTANCE_PASSWORD,phone_confirm:true,app_metadata:{xy_acceptance:marker}});if(result.error)throw result.error;accounts.push(result.data.user);
 }
 const clients=[];for(const phone of phones){const client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);const {data,error}=await client.auth.signInWithPassword({phone,password:env.ANDROID_ACCEPTANCE_PASSWORD});if(error||!data.session)throw Error('Confirmed test phone/password login failed');
  // Use the public publishable key, so the JWT/RLS check cannot inherit service-role privilege.
  const publicClient=createClient(env.SUPABASE_URL,'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM',options);await publicClient.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});clients.push(publicClient);
 }
 const ids=[];try{
  for(let i=0;i<2;i++){const {data,error}=await clients[i].from('user_favorites').insert({user_id:accounts[i].id,song_name:'Android isolated acceptance',song_url:'https://example.invalid/xy-acceptance/'+marker+'/'+i}).select('id').single();if(error)throw error;ids.push(data.id);}
  for(let i=0;i<2;i++){const {data,error}=await clients[i].from('user_favorites').select('id,user_id');if(error||data.some(row=>row.user_id!==accounts[i].id))throw Error('Favorites RLS exposed another account');const {data:removed,error:denied}=await clients[i].from('user_favorites').delete().eq('id',ids[1-i]).select('id');if(denied||removed.length)throw Error('Favorites RLS cross-account deletion check failed');}
  console.log(JSON.stringify({action,ownedTestAccounts:2,confirmedWithoutSms:true,passwordLoginPassed:true,favoritesRlsIsolationPassed:true,crossAccountDeleteBlocked:true,originalUserAccountsChanged:false}));
 }finally{for(let i=0;i<ids.length;i++)await admin.from('user_favorites').delete().eq('id',ids[i]).eq('user_id',accounts[i].id);for(const client of clients)await client.auth.signOut({scope:'local'});}
}
if(require.main===module)run().catch(error=>{let message=String(error.message||'Acceptance failed');for(const key of ['SUPABASE_SERVICE_ROLE_KEY','ANDROID_ACCEPTANCE_PASSWORD'])if(process.env[key])message=message.split(process.env[key]).join('[REDACTED]');console.error(message);process.exitCode=1;});
module.exports={run};
