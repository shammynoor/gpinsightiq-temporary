const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(request => {
  if (request.method === 'OPTIONS') return new Response(null, {headers:cors});
  return Response.json({error:'Historic Booking Activity AI insights are disabled.'}, {status:410, headers:cors});
});
