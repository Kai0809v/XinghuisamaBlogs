"""Apply upstream program files, retaining user data and a backup of replaced files."""
import os
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INITIAL_DATA = {'briefingConfig.json', 'dailyBriefing.json', 'dailyBriefingArchive.json', 'dailyBriefingCovers.json', 'dailyBriefing-history.json', 'dailyBriefing.ts', 'terraReadingNotes.ts'}


def managed_path(name):
    parts = Path(name).parts
    if len(parts) == 1:
        return name in {'update.py', 'update.bat', 'LICENSE', 'README.md', 'README_en.md', 'UpdateLog.md', '.gitignore'}
    if parts[0] == 'scripts':
        return True
    if parts[0] not in ('XHBlogs', 'my-blog-manager') or len(parts) < 2:
        return False
    if parts[1] in ('posts', 'chatters', 'moments', 'manager_data') or parts[-1] in ('siteConfig.ts', 'deploy_config.json', 'backend_config.json', 'window_config.json'):
        return False
    if parts[1] == 'data':
        return parts[-1] in INITIAL_DATA
    if parts[1] == 'app' and Path(name).suffix == '.md':
        return False
    return parts[1] in {'app', 'components', 'context', 'lib', 'cms_core', 'public'} or len(parts)==2 and parts[1] in {'package.json', 'package-lock.json', 'postcss.config.mjs', 'tsconfig.json', 'next.config.ts', 'launcher.py', 'run_me.py', 'Start.bat', '.gitignore'}


def preserve_existing(name, exists):
    if not exists:
        return False
    parts = Path(name).parts
    return len(parts)>2 and (parts[1]=='data' or parts[1]=='public' and parts[-1]!='briefing_agent.py')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    if not shutil.which('git') or not shutil.which('node') or not shutil.which('npm'):
        raise RuntimeError('Please install Git, Node.js (>=20.9) and npm first.')
    if not (ROOT/'.git').exists():
        git('init')
        git('remote','add','origin','https://github.com/heiehiehi/XinghuisamaBlogs.git')
    git('fetch','origin','main')
    names=git('ls-tree','-r','--name-only','origin/main').decode('utf-8').splitlines()
    pending=[]
    for name in names:
        if not managed_path(name):
            continue
        path=ROOT/name
        if not path.resolve().is_relative_to(ROOT.resolve()):
            raise RuntimeError('Refusing a path outside the project: '+name)
        if preserve_existing(name,path.exists()):
            continue
        content=git('show','origin/main:'+name)
        if not path.exists() or path.read_bytes()!=content:
            pending.append((name,content))
    try:
        changed=set(git('diff','HEAD','--name-only').decode('utf-8').splitlines())
    except subprocess.CalledProcessError:
        changed=set()
    state_path=ROOT/'.update-backups/last-applied.json'
    prior_state=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    changed={name for name in changed if not (ROOT/name).is_file() or hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=prior_state.get(name)}
    conflicts=changed.intersection(name for name,_ in pending)
    if conflicts:
        raise RuntimeError('Save/commit your local program edits before updating: '+', '.join(sorted(conflicts)))
    backup=ROOT/'.update-backups'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    applied=[]
    try:
        for name,content in pending:
            path=ROOT/name
            prior=path.exists()
            if prior:
                copy=backup/name; copy.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(path,copy)
            path.parent.mkdir(parents=True,exist_ok=True)
            applied.append((name,prior))
            path.write_bytes(content)
    except OSError:
        for name,prior in reversed(applied):
            if prior: shutil.copy2(backup/name,ROOT/name)
            else: (ROOT/name).unlink(missing_ok=True)
        raise
    prior_state.update({name:hashlib.sha256(content).hexdigest() for name,content in pending})
    state_path.parent.mkdir(parents=True,exist_ok=True)
    state_path.write_text(json.dumps(prior_state,indent=2),encoding='utf-8')
    npm=shutil.which('npm')
    for app in ('XHBlogs','my-blog-manager'):
        subprocess.run([npm,'install'],cwd=ROOT/app,shell=os.name=='nt',check=True)
    print('Updated program files. Personal configuration, posts, briefing data, images and private credentials were preserved.')
    if applied: print('Backup:',backup)
    print('Start the console and check your settings before publishing.')


if __name__=='__main__':
    try: main()
    except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
        print('Update stopped:',error,file=sys.stderr)
        raise SystemExit(1)
