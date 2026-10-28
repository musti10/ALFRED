"""One-shot local Pipecat/Piper bridge. No microphone, shell, or private profiles."""
import sys,os,json,io,wave,base64,contextlib,socket,asyncio,importlib.metadata
from pathlib import Path

def guard(event,args):
    if event=='socket.connect':
        addr=args[1]
        if not isinstance(addr,tuple) or addr[0] not in ('127.0.0.1','::1') or addr[1]!=11434:raise PermissionError('Only local Ollama allowed')
    if event=='socket.getaddrinfo' and args[0] not in ('127.0.0.1','localhost','::1',None):raise PermissionError('External DNS disabled')
    if event in ('subprocess.Popen','os.system','os.exec','os.posix_spawn'):raise PermissionError('Subprocesses disabled')
    if event=='open' and isinstance(args[0],(str,bytes)) and Path(os.fsdecode(args[0])).name in ('.env','.op.env'):raise PermissionError('Credential files disabled')
sys.addaudithook(guard)

def main():
    root=Path(sys.argv[1]).resolve();mode=sys.argv[2]
    model=root/'Stimmen/Thorsten/de_DE-thorsten-high.onnx'
    if not model.is_file() or not model.with_suffix('.onnx.json').is_file():raise ValueError('voice_missing')
    if importlib.metadata.version('piper-tts')!='1.8.0' or importlib.metadata.version('pipecat-ai')!='1.14.0':raise ValueError('runtime_incompatible')
    if mode=='status':return {'ready':True,'voice':'Thorsten','language':'de-DE','engine':'Piper 1.8.0','pipeline':'Pipecat 1.14.0','wakeWord':False}
    data=json.loads(sys.stdin.read(128000));text=data.get('content')
    if not isinstance(text,str) or not text.strip() or len(text)>4000:raise ValueError('invalid_input')
    if mode=='chat':
        history=data.get('history',[]);memories=data.get('memories',[])
        if not isinstance(history,list) or len(history)>10 or any(not isinstance(m,dict) or m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) for m in history) or sum(len(m['content']) for m in history)>6500:raise ValueError('invalid_history')
        if not isinstance(memories,list) or len(memories)>12 or any(not isinstance(m,dict) or not isinstance(m.get('content'),str) or len(m['content'])>500 for m in memories):raise ValueError('invalid_memories')
        sys.path.insert(0,str(root/'Sprachlabor'))
        from labor import answer,MODEL
        result=asyncio.run(answer(text,history=history,memories=memories))
        return {'content':result,'model':MODEL,'engine':'pipecat'}
    if mode=='speak':
        from piper import PiperVoice,SynthesisConfig
        voice=PiperVoice.load(str(model),use_cuda=False)
        target=io.BytesIO()
        with wave.open(target,'wb') as output:
            voice.synthesize_wav(text.strip(),output,syn_config=SynthesisConfig(length_scale=1.08,noise_scale=0.5,noise_w_scale=0.6,volume=0.95))
        audio=target.getvalue()
        if len(audio)<44 or len(audio)>8_000_000:raise ValueError('audio_size')
        return {'voice':'Thorsten','wav':base64.b64encode(audio).decode('ascii')}
    raise ValueError('invalid_mode')

try:
    with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):result=main()
    print(json.dumps(result,ensure_ascii=False))
except Exception:
    print(json.dumps({'error':'speech_failed'}));sys.exit(1)
