"""Stateless adapter for the installed Hermes framework; JSON via stdin/stdout only."""
import sys, os, json, tempfile, contextlib, socket, inspect
from pathlib import Path

MODEL = 'qwen3.5:4b-q4_K_M'
SYSTEM = ('Du bist Hermes, ein lokaler Textassistent in ALFRED. Antworte auf Deutsch, klar und ruhig. '
          'Du hast keine freigegebenen Werkzeuge und führst keine Aktionen aus. Behaupte keine erledigten Aufgaben. '
          'Deine Antwort ist ein Vorschlag, den der Nutzer selbst prüft. Erfinde keine Gegenstände, Fakten oder Fähigkeiten. '
          'Bleibe bei einfachen, alltäglichen und nachvollziehbaren Vorschlägen. Bei Unsicherheit sage es. Keine Emojis, kein erzwungener Humor.')

def network_guard(event, args):
    if event in ('subprocess.Popen', 'os.system', 'os.exec', 'os.posix_spawn'):
        raise PermissionError('ALFRED: subprocesses disabled in Hermes worker')
    if event == 'open' and isinstance(args[0], (str, bytes)) and Path(os.fsdecode(args[0])).name in ('.env', '.op.env'):
        raise PermissionError('ALFRED: private credential files disabled')
    if event == 'socket.connect':
        address = args[1]
        if not isinstance(address, tuple) or address[0] not in ('127.0.0.1', '::1') or address[1] != 11434:
            raise PermissionError('ALFRED: only local Ollama connections allowed')
    if event == 'socket.getaddrinfo' and args[0] not in ('127.0.0.1', 'localhost', '::1'):
        raise PermissionError('ALFRED: external DNS disabled')

sys.addaudithook(network_guard)

def main():
    root = Path(sys.argv[1]).resolve()
    mode = sys.argv[2]
    if mode not in ('status', 'run') or not (root / 'hermes_bootstrap.py').is_file():
        raise ValueError('runtime_missing')
    # Select only the already-installed dependency generation; never install/update from this adapter.
    os.environ['HERMES_HOME'] = str(root.parent)
    os.environ['HERMES_DISABLE_LAZY_INSTALLS'] = '1'
    sys.path.insert(0, str(root))
    import hermes_bootstrap
    payload = json.loads(sys.stdin.read(20000)) if mode == 'run' else {}
    content = payload.get('content', '')
    if mode == 'run' and (not isinstance(content, str) or not content.strip() or len(content) > 4000):
        raise ValueError('invalid_input')
    # Never read the user's Hermes profile, .env, sessions, skills or project files.
    with tempfile.TemporaryDirectory(prefix='isolated-', dir=os.environ.get('ALFRED_HERMES_WORKSPACE')) as temporary:
        home = Path(temporary)
        os.chmod(home, 0o700)
        os.environ['HERMES_HOME'] = str(home)
        os.environ['HERMES_CWD'] = str(home)
        os.environ['TERMINAL_CWD'] = str(home)
        os.chdir(home)
        for key in ('TMPDIR', 'TMP', 'TEMP'):
            os.environ[key] = str(home)
        cfg = {
            'model': {'default': MODEL, 'provider': 'custom', 'base_url': 'http://127.0.0.1:11434/v1',
                      'api_key': 'ollama', 'api_mode': 'chat_completions', 'context_length': 65536, 'ollama_num_ctx': 65536},
            'platform_toolsets': {'cli': []}, 'fallback_providers': [], 'mcp_servers': {}, 'hooks': {},
            'agent': {'max_turns': 2, 'run_budget_seconds': 150, 'coding_context': 'off', 'reasoning_effort': 'none'},
            'memory': {'memory_enabled': False, 'user_profile_enabled': False, 'provider': ''},
            'skills': {'auto_load': [], 'external_dirs': [], 'project_discovery': False, 'inline_shell': False},
            'auxiliary': {'background_review': {'enabled': False}}, 'curator': {'enabled': False},
            'approvals': {'mode': 'manual'}, 'compression': {'enabled': False},
        }
        config = home / 'config.yaml'
        config.write_text(json.dumps(cfg), encoding='utf-8'); config.chmod(0o600)
        from toolsets import TOOLSETS
        cfg['agent']['disabled_toolsets'] = sorted(TOOLSETS)
        config.write_text(json.dumps(cfg), encoding='utf-8')
        from model_tools import get_tool_definitions
        tools = get_tool_definitions(enabled_toolsets=[], disabled_toolsets=sorted(TOOLSETS), quiet_mode=True)
        if tools:
            raise ValueError('tools_enabled')
        # Suppress the framework's optional project .env fallback and secret-provider hydration.
        import hermes_cli.env_loader as env_loader
        env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
        from run_agent import AIAgent
        required = {'enabled_toolsets', 'disabled_toolsets', 'skip_context_files', 'skip_memory', 'skip_background_review', 'session_db'}
        if not required.issubset(inspect.signature(AIAgent).parameters):
            raise ValueError('runtime_incompatible')
        if mode == 'status':
            # Probe the audit hooks without making a real external connection or reading a secret.
            try:
                socket.create_connection(('203.0.113.1', 443), timeout=0.1)
            except PermissionError:
                pass
            else:
                raise ValueError('network_guard_missing')
            try:
                open(root.parent / '.env', 'rb')
            except PermissionError:
                pass
            else:
                raise ValueError('credential_guard_missing')
            return {'ready': True, 'model': MODEL, 'tools': 0, 'context': 65536}
        agent = None
        try:
            agent = AIAgent(model=MODEL, provider='custom', requested_provider='custom',
                base_url='http://127.0.0.1:11434/v1', api_key='ollama', api_mode='chat_completions',
                enabled_toolsets=[], disabled_toolsets=sorted(TOOLSETS), max_iterations=2,
                max_tokens=1600, run_budget_seconds=150, quiet_mode=True,
                skip_context_files=True, load_soul_identity=False, skip_memory=True, skip_background_review=True,
                save_trajectories=False, verbose_logging=False, session_db=None, fallback_model=None,
                ephemeral_system_prompt=SYSTEM, reasoning_config={'enabled': False},
                request_overrides={'temperature': 0.2, 'top_p': 0.9, 'extra_body': {'think': False}}, cwd=str(home), platform='cli')
            if agent.tools:
                raise ValueError('tools_enabled')
            agent.suppress_status_output = True
            result = agent.run_conversation(content.strip())
            answer = result.get('final_response', '')
            if result.get('failed') or result.get('partial') or result.get('interrupted') or result.get('completed') is False:
                raise ValueError('incomplete_response')
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 64000:
                raise ValueError('invalid_response')
            if '<think>' in answer or '</think>' in answer:
                raise ValueError('reasoning_in_response')
            return {'content': answer.strip(), 'model': MODEL, 'tools': 0}
        finally:
            if agent is not None:
                agent.close()

try:
    # Framework diagnostics never become a response or a private content log.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        response = main()
    print(json.dumps(response, ensure_ascii=False))
except Exception:
    print(json.dumps({'error': 'hermes_failed'}))
    sys.exit(1)
