import asyncio,json,socket,unittest
from aiohttp import web,ClientSession
from aiohttp.test_utils import TestServer,TestClient
from labor import answer,create_app,MODEL,synthesize

class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_pipecat_pipeline_only_sends_current_question(self):
        received=[]
        async def ollama(request):
            received.append(await request.json())
            response=web.StreamResponse(headers={'Content-Type':'text/event-stream'});await response.prepare(request)
            for delta,finish in [({'content':'Guten '},None),({'content':'Abend.'},None),({},'stop')]:
                chunk={'id':'test','object':'chat.completion.chunk','created':1,'model':MODEL,'choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
                await response.write(('data: '+json.dumps(chunk)+'\n\n').encode())
            await response.write(b'data: [DONE]\n\n');await response.write_eof();return response
        async def tags(request):return web.json_response({'models':[{'name':MODEL}]})
        app=web.Application();app.router.add_post('/v1/chat/completions',ollama);app.router.add_get('/api/tags',tags)
        async with TestServer(app) as server:
            result=await answer('Nur diese Frage.',str(server.make_url('/v1')))
        self.assertEqual(result,'Guten Abend.');self.assertEqual(received[0]['model'],MODEL)
        self.assertEqual([m['role'] for m in received[0]['messages']],['system','user'])
        self.assertEqual(received[0]['messages'][1]['content'],'Nur diese Frage.')
        self.assertFalse(received[0].get('tools'));self.assertEqual(received[0]['reasoning_effort'],'none')

    async def test_truncated_model_response_is_not_spoken(self):
        async def ollama(request):
            data={'id':'x','object':'chat.completion.chunk','created':1,'model':MODEL,'choices':[{'index':0,'delta':{'content':'Unvollständig'},'finish_reason':'length'}]}
            return web.Response(text='data: '+json.dumps(data)+'\n\ndata: [DONE]\n\n',content_type='text/event-stream')
        async def tags(request):return web.json_response({'models':[{'name':MODEL}]})
        app=web.Application();app.router.add_post('/v1/chat/completions',ollama);app.router.add_get('/api/tags',tags)
        async with TestServer(app) as server:
            with self.assertRaises(ValueError):await answer('Test',str(server.make_url('/v1')))

    async def test_confirmation_origins_limits_and_opt_in_audio(self):
        calls=[];spoken=[]
        async def respond(text):calls.append(text);return 'Antwort.'
        async def say(text):spoken.append(text);return b'test-wave'
        async with TestClient(TestServer(create_app(respond,say))) as client:
            for body in [{'content':'Test','speak':False},{'content':'Test','confirmed':True,'speak':False,'url':'https://evil.test'},{'content':'x'*4001,'confirmed':True,'speak':False}]:
                response=await client.post('/api/answer',json=body);self.assertEqual(response.status,400)
            response=await client.post('/api/answer',json={'content':'Test','confirmed':True,'speak':False},headers={'Origin':'https://evil.test'});self.assertEqual(response.status,403)
            response=await client.get('/',headers={'Host':'evil.test:3213'});self.assertEqual(response.status,403)
            self.assertEqual(calls,[])
            response=await client.post('/api/answer',json={'content':'Nur bestätigt','confirmed':True,'speak':False});data=await response.json();self.assertEqual(data['content'],'Antwort.');self.assertIsNone(data['audio']);self.assertEqual(spoken,[])
            response=await client.post('/api/answer',json={'content':'Mit Stimme','confirmed':True,'speak':True});self.assertEqual(response.status,200);self.assertTrue((await response.json())['audio']);self.assertEqual(spoken,['Antwort.'])
            page=await client.get('/');self.assertIn("frame-ancestors 'none'",page.headers['Content-Security-Policy'])
            self.assertEqual((await client.get('/api/export')).status,404)

    async def test_only_one_request_and_disconnect_cancels_work(self):
        entered=asyncio.Event();cancelled=asyncio.Event();mode='wait'
        async def respond(text):
            if mode=='wait':
                entered.set()
                try:await asyncio.Future()
                except asyncio.CancelledError:cancelled.set();raise
            return 'Erledigt.'
        async def say(text):return b''
        async with TestServer(create_app(respond,say),handler_cancellation=True) as server:
            async with ClientSession() as client:
                pending=asyncio.create_task(client.post(server.make_url('/api/answer'),json={'content':'Test','confirmed':True,'speak':False}))
                await asyncio.wait_for(entered.wait(),3)
                response=await client.post(server.make_url('/api/answer'),json={'content':'Zweiter','confirmed':True,'speak':False});self.assertEqual(response.status,409)
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError):await pending
                await asyncio.wait_for(cancelled.wait(),3)
                mode='done';response=await client.post(server.make_url('/api/answer'),json={'content':'Neuer','confirmed':True,'speak':False});self.assertEqual(response.status,200)

    async def test_no_remote_network_and_no_invalid_synthesis(self):
        with self.assertRaises(PermissionError):socket.create_connection(('invalid.example',443),timeout=0.1)
        with self.assertRaises(ValueError):await answer('Test','https://api.example/v1')
        with self.assertRaises(ValueError):await synthesize('x'*2001)

if __name__=='__main__':unittest.main()

class ModelBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_cloud_tag_is_rejected_before_generation(self):
        called=False
        async def tags(request):return web.json_response({'models':[{'name':MODEL,'remote_host':'cloud.example'}]})
        async def generate(request):
            nonlocal called
            called=True;return web.json_response({})
        app=web.Application();app.router.add_get('/api/tags',tags);app.router.add_post('/v1/chat/completions',generate)
        async with TestServer(app) as server:
            with self.assertRaisesRegex(ValueError,'Cloud'):await answer('Test',str(server.make_url('/v1')))
        self.assertFalse(called)
